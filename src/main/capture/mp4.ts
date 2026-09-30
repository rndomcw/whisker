// Minimal MP4 (ISO BMFF) writer for a single H.264 video track, plus Annex B → AVCC conversion.
// Layout: ftyp, moov (sample tables), mdat (all samples in one chunk).

export interface Sample {
  /** AVCC data: NAL units with 4-byte length prefixes. */
  data: Buffer;
  /** Presentation time in µs. */
  pts: number;
  key: boolean;
}

export interface AvcConfig {
  sps: Buffer;
  pps: Buffer;
  width: number;
  height: number;
}

const TIMESCALE = 90000;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

/** Splits Annex B data (00 00 01 / 00 00 00 01 start codes) into NAL units. */
export function splitNals(data: Buffer): Buffer[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < data.length;) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 3;
    } else {
      i++;
    }
  }
  return starts.map((s, k) => {
    let e = k + 1 < starts.length ? starts[k + 1] - 3 : data.length;
    while (e > s && data[e - 1] === 0) e--; // zero before a 4-byte start code
    return data.subarray(s, e);
  });
}

/** SPS and PPS from a config packet. */
export function parseConfig(annexB: Buffer): { sps: Buffer; pps: Buffer } | null {
  const nals = splitNals(annexB);
  const sps = nals.find(n => (n[0] & 0x1f) === NAL_SPS);
  const pps = nals.find(n => (n[0] & 0x1f) === NAL_PPS);
  return sps && pps ? { sps: Buffer.from(sps), pps: Buffer.from(pps) } : null;
}

/** Converts a frame to AVCC, dropping parameter sets and access unit delimiters (they live in avcC). */
export function toAvcc(annexB: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (const nal of splitNals(annexB)) {
    const type = nal[0] & 0x1f;
    if (type === NAL_SPS || type === NAL_PPS || type === NAL_AUD) continue;
    const len = Buffer.alloc(4);
    len.writeUInt32BE(nal.length);
    parts.push(len, nal);
  }
  return Buffer.concat(parts);
}

// ---------- box helpers ----------

function box(type: string, ...parts: Buffer[]): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0));
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, ...parts]);
}

function fullBox(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version << 24) | flags) >>> 0);
  return box(type, vf, ...parts);
}

function u32(values: readonly number[]): Buffer {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
  return b;
}

function u16(values: readonly number[]): Buffer {
  const b = Buffer.alloc(2 * values.length);
  values.forEach((v, i) => b.writeUInt16BE(v & 0xffff, i * 2));
  return b;
}

const MATRIX = u32([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]);

function avcC(sps: Buffer, pps: Buffer): Buffer {
  const parts = [
    Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1]), // version, profile, compat, level, 4-byte lengths, 1 SPS
    u16([sps.length]), sps,
    Buffer.from([1]), u16([pps.length]), pps,
  ];
  // High profiles carry chroma format and bit depth; Android encoders produce 4:2:0, 8-bit.
  if ([100, 110, 122, 144].includes(sps[1])) parts.push(Buffer.from([0xfd, 0xf8, 0xf8, 0]));
  return box('avcC', ...parts);
}

function avc1(c: AvcConfig): Buffer {
  return box('avc1',
    Buffer.alloc(6), u16([1]),                 // reserved, data_reference_index
    Buffer.alloc(16),                          // pre_defined, reserved
    u16([c.width, c.height]),
    u32([0x00480000, 0x00480000, 0]), u16([1]), // 72 dpi, reserved, frame_count
    Buffer.alloc(32),                          // compressorname
    u16([0x0018, 0xffff]),                     // depth, pre_defined = -1
    avcC(c.sps, c.pps));
}

// ---------- writer ----------

export interface MuxOptions {
  /**
   * Hides this much of the start with an edit list: the frames are still stored (a decoder needs them
   * from the key frame on) but playback starts later, which trims precisely without re-encoding.
   */
  skipUs?: number;
  /** Absolute end time (µs); the last frame is shown until then. Frames arrive only when the screen changes. */
  endPts?: number;
}

/** Builds an MP4 file from samples (the first should be a key frame). */
export function muxMp4(config: AvcConfig, samples: readonly Sample[], { skipUs = 0, endPts }: MuxOptions = {}):
  { data: Buffer; durationMs: number } {
  if (!samples.length) throw new Error('Nothing was recorded');
  const t0 = samples[0].pts;
  const toTicks = (pts: number) => Math.round(((pts - t0) * TIMESCALE) / 1e6);
  const ticks = samples.map(s => toTicks(s.pts));
  const deltas = ticks.map((t, i) => {
    if (i + 1 < ticks.length) return Math.max(1, ticks[i + 1] - t);
    if (endPts !== undefined) return Math.max(1, toTicks(endPts) - t);
    return i > 0 ? Math.max(1, t - ticks[i - 1]) : Math.round(TIMESCALE / 30);
  });
  const stts: number[] = []; // run-length (count, delta) pairs
  for (const d of deltas) {
    if (stts.length && stts[stts.length - 1] === d) stts[stts.length - 2]++;
    else stts.push(1, d);
  }
  const duration = ticks[ticks.length - 1] + deltas[deltas.length - 1];
  const skip = Math.min(Math.round((skipUs * TIMESCALE) / 1e6), Math.max(0, duration - 1));
  const durationMs = Math.round(((duration - skip) * 1000) / TIMESCALE); // what plays
  const syncs = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const sizes = samples.map(s => s.data.length);
  const w = config.width, h = config.height;

  const moov = (chunkOffset: number) => box('moov',
    fullBox('mvhd', 0, 0, u32([0, 0, 1000, durationMs, 0x00010000]), u16([0x0100]), Buffer.alloc(10), MATRIX,
      Buffer.alloc(24), u32([2])),
    box('trak',
      fullBox('tkhd', 0, 3, u32([0, 0, 1, 0, durationMs]), Buffer.alloc(8), u16([0, 0, 0, 0]), MATRIX,
        u32([w * 65536, h * 65536])),
      // One edit: play `durationMs` of the media starting at `skip` (media timescale), at normal rate.
      box('edts', fullBox('elst', 0, 0, u32([1, durationMs, skip]), u16([1, 0]))),
      box('mdia',
        fullBox('mdhd', 0, 0, u32([0, 0, TIMESCALE, duration]), u16([0x55c4, 0])), // language "und"
        fullBox('hdlr', 0, 0, u32([0]), Buffer.from('vide'), Buffer.alloc(12), Buffer.from('VideoHandler\0')),
        box('minf',
          fullBox('vmhd', 0, 1, u16([0, 0, 0, 0])),
          box('dinf', fullBox('dref', 0, 0, u32([1]), fullBox('url ', 0, 1))),
          box('stbl',
            fullBox('stsd', 0, 0, u32([1]), avc1(config)),
            fullBox('stts', 0, 0, u32([stts.length / 2, ...stts])),
            fullBox('stss', 0, 0, u32([syncs.length]), u32(syncs)),
            fullBox('stsc', 0, 0, u32([1, 1, samples.length, 1])),
            fullBox('stsz', 0, 0, u32([0, samples.length]), u32(sizes)),
            fullBox('stco', 0, 0, u32([1, chunkOffset])))))));

  const ftyp = box('ftyp', Buffer.from('isom'), u32([0x200]), Buffer.from('isomiso2avc1mp41'));
  const moovSize = moov(0).length;
  const mdatHead = Buffer.alloc(8);
  mdatHead.writeUInt32BE(8 + sizes.reduce((n, s) => n + s, 0));
  mdatHead.write('mdat', 4, 'latin1');
  const data = Buffer.concat([ftyp, moov(ftyp.length + moovSize + 8), mdatHead, ...samples.map(s => s.data)]);
  return { data, durationMs };
}
