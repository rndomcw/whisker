// Decodes scrcpy's H.264 stream with WebCodecs.

/** WebCodecs needs "avc1.PPCCLL" (profile, constraints, level) from the SPS. */
function avcCodec(buf: Uint8Array): string {
  for (let i = 0; i + 6 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1 && (buf[i + 3] & 0x1f) === 7) {
      const hex = (b: number) => b.toString(16).padStart(2, '0');
      return 'avc1.' + hex(buf[i + 4]) + hex(buf[i + 5]) + hex(buf[i + 6]);
    }
  }
  return 'avc1.42001f';
}

export interface VideoPacket {
  config: boolean;
  key: boolean;
  pts: number;
  data: Uint8Array;
}

export class MirrorDecoder {
  private decoder: VideoDecoder | null = null;
  private codec = '';
  /** Latest SPS/PPS, prepended to key frames. */
  private configData: Uint8Array | null = null;
  private needKey = true;

  /**
   * @param onFrame receives each decoded frame; the decoder closes it afterwards.
   * @param requestKeyFrame asks the server for a fresh config + key frame after an error.
   */
  constructor(
    private readonly onFrame: (frame: VideoFrame) => void,
    private readonly requestKeyFrame: () => void,
  ) {}

  push(p: VideoPacket): void {
    if (p.config) {
      const c = avcCodec(p.data);
      if (!this.decoder || this.decoder.state === 'closed' || c !== this.codec) this.configure(c);
      this.configData = p.data;
      this.needKey = true;
      return;
    }
    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') return;
    if (this.needKey && !p.key) return;
    if (decoder.decodeQueueSize > 30) { this.recover(); return; } // falling behind: skip to a fresh key frame
    this.needKey = false;
    let chunk = p.data;
    if (p.key && this.configData) {
      chunk = new Uint8Array(this.configData.length + p.data.length);
      chunk.set(this.configData);
      chunk.set(p.data, this.configData.length);
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: p.pts, data: chunk }));
    } catch (err) {
      console.warn('mirror decode failed', err);
      this.recover();
    }
  }

  close(): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.configData = null;
    this.needKey = true;
  }

  private recover(): void {
    this.needKey = true;
    this.requestKeyFrame();
  }

  private configure(codec: string): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.codec = codec;
    this.decoder = new VideoDecoder({
      output: frame => {
        try { this.onFrame(frame); } finally { frame.close(); }
      },
      error: err => {
        console.warn('mirror decoder error', err);
        this.configure(this.codec);
        this.recover();
      },
    });
    this.decoder.configure({ codec, optimizeForLatency: true });
    this.needKey = true;
  }
}
