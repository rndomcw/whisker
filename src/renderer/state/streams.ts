// Routes logcat stream events from the main process to the tab that opened the stream.

import type { StreamOptions } from '../../shared/types';
import { api } from '../api';
import type { Tab } from './Tab';

let seq = 0;
const owners = new Map<number, Tab>();

export function openStream(tab: Tab, opts: StreamOptions): number {
  const id = ++seq;
  owners.set(id, tab);
  api.start(id, opts);
  return id;
}

export function closeStream(id: number): void {
  api.stop(id);
  owners.delete(id);
}

export function initStreamRouting(): void {
  // Events are tagged with the stream id, so output from a stream that was already replaced is ignored.
  api.onLines((id, batch) => {
    const t = owners.get(id);
    if (t && t.streamId === id) t.onLines(batch);
  });
  api.onEnd((id, info) => {
    const t = owners.get(id);
    if (t && t.streamId === id) t.dropped(info?.error || 'logcat ended');
  });
}
