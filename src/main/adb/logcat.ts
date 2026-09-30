// Streaming and parsing `adb logcat -v threadtime`.

import { spawn } from 'node:child_process';
import type { LogLine, StreamEnd, StreamOptions } from '../../shared/types';
import { ADB, runAdb } from './adb';

// threadtime: "09-30 12:34:56.789  1234  5678 D Tag     : message" (optionally with a "2026-" year prefix)
const LINE_RE = /^(?:(\d{4})-)?(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+(.*?)\s*:(?: (.*))?$/;

// logcat's threadtime format has no year; pick the one that puts the date nearest to today.
function inferYear(mmdd: string): number {
  const now = new Date();
  const month = Number(mmdd.slice(0, 2));
  const diff = month - (now.getMonth() + 1);
  return now.getFullYear() + (diff > 6 ? -1 : diff < -6 ? 1 : 0);
}

export function parseLine(line: string): LogLine {
  const m = LINE_RE.exec(line);
  if (!m) return line;
  const [, year, mmdd = '', time = '', pid = '', tid = '', level = '', tag = '', msg = ''] = m;
  return [`${year || inferYear(mmdd)}-${mmdd}`, time, pid, tid, level, tag, msg];
}

export async function clearLog(serial: string, buffer: string): Promise<void> {
  const args = ['-s', serial, 'logcat'];
  if (buffer && buffer !== 'default') args.push('-b', buffer);
  await runAdb([...args, '-c']);
}

/** Streams parsed logcat lines in batches. Returns a function that stops the stream. */
export function streamLogcat(
  { serial, buffer, since, tail }: StreamOptions,
  onLines: (batch: LogLine[]) => void,
  onEnd: (info: StreamEnd) => void,
): () => void {
  const args = ['-s', serial, 'logcat', '-v', 'threadtime'];
  if (buffer && buffer !== 'default') args.push('-b', buffer);
  // -T keeps streaming (unlike -t). Resume from a timestamp after a reconnect, else show recent history.
  args.push('-T', since || String(Number(tail) || 5000));

  const child = spawn(ADB, args, { windowsHide: true });
  let partial = '';
  let pending: LogLine[] = [];
  let stderr = '';
  let done = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    const parts = (partial + chunk).split('\n');
    partial = parts.pop() ?? '';
    for (const p of parts) pending.push(parseLine(p.replace(/\r+$/, '')));
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => { stderr += d; });

  const flush = () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    onLines(batch);
  };
  const flushTimer = setInterval(flush, 50);

  const finish = (info: StreamEnd | null) => {
    if (done) return;
    done = true;
    clearInterval(flushTimer);
    if (info) {
      if (partial) pending.push(parseLine(partial.replace(/\r+$/, '')));
      flush();
      onEnd(info);
    }
  };

  child.on('error', err => finish({ error: `failed to run adb (${ADB}): ${err.message}` }));
  child.on('close', code => finish({ code, error: stderr.trim() || `logcat exited (code ${code})` }));

  return () => {
    finish(null);
    child.kill();
  };
}
