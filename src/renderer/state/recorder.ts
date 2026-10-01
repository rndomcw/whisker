// Screen recording state: starting, progress for the REC badge, and what happens when it stops.

import { createSignal } from 'solid-js';
import type { RecordEvent } from '../../shared/types';
import { api } from '../api';
import { openRecordingDialog } from '../components/capture/RecordingDialog';
import { autoSaveRecording, isAutoSave } from './capture';
import { deviceName } from './devices';
import { toast } from './toast';

export interface Recording {
  id: number;
  serial: string;
  started: boolean;
  durationMs: number;
  bytes: number;
  stopping: boolean;
}

let seq = 0;
const [rec, setRec] = createSignal<Recording | null>(null);

/** The recording in progress, if any. */
export const recording = rec;
export const isRecording = () => rec() !== null;

const update = (patch: Partial<Recording>) => setRec(r => (r ? { ...r, ...patch } : r));

export function startRecording(serial: string): void {
  if (rec()) return;
  const r: Recording = { id: ++seq, serial, started: false, durationMs: 0, bytes: 0, stopping: false };
  setRec(r);
  api.recordStart(r.id, serial);
}

/** Stops recording and opens the preview. `note` explains why it stopped, if it wasn't the user. */
export async function stopRecording(note = ''): Promise<void> {
  const r = rec();
  if (!r || r.stopping) return;
  update({ stopping: true });
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
    setRec(null);
  }
}

function onEvent(event: RecordEvent): void {
  switch (event.type) {
    case 'status':
      break;
    case 'started':
      update({ started: true });
      break;
    case 'progress':
      update({ durationMs: event.durationMs, bytes: event.bytes });
      break;
    case 'end':
      void stopRecording(event.error);
      break;
  }
}

export function initRecorder(): void {
  api.onRecord((id, event) => { if (rec()?.id === id) onEvent(event); });
}
