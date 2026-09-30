// Recording control: the toolbar button, the REC badge, and opening the preview when it stops.

import type { RecordEvent } from '../../shared/types';
import { api } from '../api';
import { deviceName } from '../devices';
import { els } from '../dom';
import { toast } from '../ui/toast';
import { formatSize } from '../util/text';
import { autoSaveRecording, isAutoSave } from './captureSettings';
import { openRecordingDialog } from './recordingDialog';

interface ActiveRecording {
  id: number;
  serial: string;
  started: boolean;
  durationMs: number;
  bytes: number;
  stopping: boolean;
}

let seq = 0;
let rec: ActiveRecording | null = null;
/** Called when recording starts or stops, e.g. to refresh the toolbar. */
let onStateChange: () => void = () => {};

export const isRecording = () => rec !== null;

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderBadge(): void {
  els.recBadge.hidden = !rec;
  if (!rec) return;
  els.recBadge.classList.toggle('live', rec.started);
  els.recText.textContent = rec.stopping
    ? 'Finishing…'
    : rec.started
      ? `REC ${formatClock(rec.durationMs)} · ${formatSize(rec.bytes)}`
      : 'Starting recorder…';
  els.recStop.disabled = rec.stopping;
}

export function startRecording(serial: string): void {
  if (rec) return;
  rec = { id: ++seq, serial, started: false, durationMs: 0, bytes: 0, stopping: false };
  api.recordStart(rec.id, serial);
  renderBadge();
  onStateChange();
}

/** Stops recording and opens the preview. `note` explains why it stopped, if it wasn't the user. */
export async function stopRecording(note = ''): Promise<void> {
  const r = rec;
  if (!r || r.stopping) return;
  r.stopping = true;
  renderBadge();
  try {
    if (isAutoSave() && r.started) {
      await autoSaveRecording(r.id, r.serial, note);
      return;
    }
    const result = await api.recordStop(r.id);
    if (result) openRecordingDialog(r.id, result, deviceName(r.serial), note);
    else toast(note || 'Nothing was recorded');
  } catch (e) {
    toast('Recording failed: ' + (e as Error).message);
    api.recordDiscard(r.id);
  } finally {
    rec = null;
    renderBadge();
    onStateChange();
  }
}

function onEvent(event: RecordEvent): void {
  if (!rec) return;
  switch (event.type) {
    case 'status':
      break;
    case 'started':
      rec.started = true;
      break;
    case 'progress':
      rec.durationMs = event.durationMs;
      rec.bytes = event.bytes;
      break;
    case 'end':
      void stopRecording(event.error);
      return;
  }
  renderBadge();
}

export function initRecorder(opts: { onStateChange: () => void }): void {
  onStateChange = opts.onStateChange;
  api.onRecord((id, event) => { if (rec && id === rec.id) onEvent(event); });
  els.recStop.addEventListener('click', () => void stopRecording());
}
