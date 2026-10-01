/** Accumulates socket chunks so fixed-size fields can be read across chunk boundaries. */
export class ByteQueue {
  private chunks: Buffer[] = [];
  length = 0;

  push(buf: Buffer): void {
    this.chunks.push(buf);
    this.length += buf.length;
  }

  /** Removes and returns the next `n` bytes; callers check `length` first. */
  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k);
      off += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.length -= n;
    return out;
  }
}
