// Tracks the logcat streams and mirror sessions each window started, so a reload or closed window
// never leaves adb logcat or scrcpy processes running.

import type { WebContents } from 'electron';
import type { Recording } from './capture/recording';
import type { MirrorSession } from './mirror/mirrorSession';

const streams = new Map<string, () => void>();       // `${webContentsId}:${streamId}` → stop function
const mirrors = new Map<string, MirrorSession>();    // `${webContentsId}:${mirrorId}` → session
const recordings = new Map<string, Recording>();     // `${webContentsId}:${recordingId}` → recording (kept until discarded)
const watched = new WeakSet<WebContents>();

export const sessionKey = (sender: WebContents, id: number) => `${sender.id}:${id}`;

export function addStream(key: string, stop: () => void): void {
  stopStream(key);
  streams.set(key, stop);
}

/** Forgets a stream that already ended on its own. */
export function forgetStream(key: string): void {
  streams.delete(key);
}

export function stopStream(key: string): void {
  const stop = streams.get(key);
  if (stop) {
    streams.delete(key);
    stop();
  }
}

export function addMirror(key: string, session: MirrorSession): void {
  stopMirror(key);
  mirrors.set(key, session);
}

export function getMirror(key: string): MirrorSession | undefined {
  return mirrors.get(key);
}

export function forgetMirror(key: string): void {
  mirrors.delete(key);
}

export function stopMirror(key: string): void {
  const m = mirrors.get(key);
  if (m) {
    mirrors.delete(key);
    m.stop();
  }
}

export function addRecording(key: string, recording: Recording): void {
  discardRecording(key);
  recordings.set(key, recording);
}

export function getRecording(key: string): Recording | undefined {
  return recordings.get(key);
}

export function discardRecording(key: string): void {
  const r = recordings.get(key);
  if (r) {
    recordings.delete(key);
    r.dispose();
  }
}

function stopAllFor(contentsId: number): void {
  const prefix = `${contentsId}:`;
  for (const key of [...streams.keys()]) if (key.startsWith(prefix)) stopStream(key);
  for (const key of [...mirrors.keys()]) if (key.startsWith(prefix)) stopMirror(key);
  for (const key of [...recordings.keys()]) if (key.startsWith(prefix)) discardRecording(key);
}

export function stopAll(): void {
  for (const key of [...streams.keys()]) stopStream(key);
  for (const key of [...mirrors.keys()]) stopMirror(key);
  for (const key of [...recordings.keys()]) discardRecording(key);
}

export function watchSender(sender: WebContents): void {
  if (watched.has(sender)) return;
  watched.add(sender);
  const contentsId = sender.id;
  sender.on('destroyed', () => stopAllFor(contentsId));
  sender.on('did-navigate', () => stopAllFor(contentsId));
}
