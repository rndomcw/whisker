// Screen recording: a video-only scrcpy session whose H.264 frames are kept in memory and muxed to MP4.

import type { MirrorEvent, RecordEvent, TrimRange } from '../../shared/types';
import { MirrorSession } from '../mirror/MirrorSession';
import { muxMp4, parseConfig, type Sample, toAvcc } from './mp4';

/** Stop on our own after this long, to bound memory. */
const MAX_DURATION_MS = 30 * 60 * 1000;
const PROGRESS_MS = 500;

const RECORD_OPTIONS = {
  maxSize: 0,          // device resolution
  bitRate: 8000000,
  maxFps: 60,
  control: false,
  extraArgs: [
    'video_codec_options=i-frame-interval=1', // a key frame every second, so trimming lands close to the chosen start
    'capture_orientation=@',                  // keep the starting orientation; one MP4 track can't change size
  ],
};

export class Recording {
  private readonly session: MirrorSession;
  private samples: Sample[] = [];
  private config: { sps: Buffer; pps: Buffer } | null = null;
  private width = 0;
  private height = 0;
  private bytes = 0;
  /** Wall-clock arrival of the first and latest frame. */
  private firstArrival = 0;
  private lastArrival = 0;
  /** End of the recording in the device's pts timeline, set on stop. */
  private endPts: number | undefined;
  /** No more frames are taken (stopped, or the stream changed shape). */
  private closed = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(serial: string, private readonly emit: (event: RecordEvent) => void) {
    this.session = new MirrorSession(serial, e => this.onSessionEvent(e));
  }

  start(): void {
    void this.session.start(RECORD_OPTIONS);
    this.timer = setInterval(() => {
      const durationMs = this.durationMs();
      this.emit({ type: 'progress', durationMs, bytes: this.bytes });
      if (durationMs >= MAX_DURATION_MS) this.finish('Reached the 30 minute recording limit');
    }, PROGRESS_MS);
  }

  /** Stops capturing; the frames stay available for export until dispose(). */
  stop(): void {
    if (!this.closed && this.samples.length) {
      // Frames only arrive when the screen changes, so the last one lasts until now.
      this.endPts = this.samples[this.samples.length - 1].pts + (Date.now() - this.lastArrival) * 1000;
    }
    this.closed = true;
    clearInterval(this.timer);
    this.session.stop();
  }

  dispose(): void {
    this.stop();
    this.samples = [];
  }

  get hasFrames(): boolean {
    return this.samples.length > 0;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * MP4 of the whole recording, or of `range`. Frames are stored from the key frame at or before the
   * start (the decoder needs them), and an edit list makes playback begin exactly at range.startMs.
   */
  export(range: TrimRange | null): { data: Buffer; durationMs: number } {
    if (!this.config || !this.samples.length) throw new Error('Nothing was recorded');
    const config = { ...this.config, width: this.width, height: this.height };
    if (!range) return muxMp4(config, this.samples, { endPts: this.endPts });
    const t0 = this.samples[0].pts;
    const startUs = t0 + range.startMs * 1000;
    const endUs = Math.min(t0 + range.endMs * 1000, this.endPts ?? Infinity);
    let first = 0;
    for (let i = 0; i < this.samples.length && this.samples[i].pts <= startUs; i++) {
      if (this.samples[i].key) first = i;
    }
    let end = this.samples.findIndex(s => s.pts >= endUs);
    if (end < 0) end = this.samples.length;
    end = Math.max(end, first + 1);
    return muxMp4(config, this.samples.slice(first, end), {
      skipUs: Math.max(0, startUs - this.samples[first].pts),
      endPts: endUs,
    });
  }

  private durationMs(): number {
    return this.firstArrival ? Date.now() - this.firstArrival : 0;
  }

  /** Ends the recording on our side and tells the renderer to collect it. */
  private finish(reason: string): void {
    if (this.closed) return;
    this.stop();
    this.emit({ type: 'end', error: reason });
  }

  private onSessionEvent(e: MirrorEvent): void {
    if (this.closed) return;
    switch (e.type) {
      case 'status':
        this.emit(e);
        break;
      case 'session':
        if (!this.samples.length) { this.width = e.width; this.height = e.height; }
        else if (e.width !== this.width || e.height !== this.height) this.finish('Recording stopped: the screen size changed');
        break;
      case 'packet':
        if (e.config) {
          const config = parseConfig(Buffer.from(e.data));
          if (!config) return;
          if (this.config && this.samples.length && !config.sps.equals(this.config.sps)) {
            this.finish('Recording stopped: the video format changed');
            return;
          }
          this.config = config;
          return;
        }
        if (!this.config || (!this.samples.length && !e.key)) return; // start on a key frame
        this.samples.push({ data: toAvcc(Buffer.from(e.data)), pts: e.pts, key: e.key });
        this.bytes += e.data.length;
        this.lastArrival = Date.now();
        if (this.samples.length === 1) {
          this.firstArrival = this.lastArrival;
          this.emit({ type: 'started', width: this.width, height: this.height });
        }
        break;
      case 'end':
        this.finish(e.error || 'Recording stopped');
        break;
      case 'device':
        break;
    }
  }
}
