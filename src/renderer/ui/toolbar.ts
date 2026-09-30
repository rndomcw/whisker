// The vertical toolbar left of the log.

import { api } from '../api';
import { autoSaveScreenshot, captureFolder, captureMenuItems, isAutoSave } from '../capture/captureSettings';
import { isRecording, startRecording, stopRecording } from '../capture/recorder';
import { openScreenshotDialog } from '../capture/screenshotDialog';
import { deviceName, deviceOnline } from '../devices';
import { els } from '../dom';
import { exportLine } from '../log/entry';
import { isMirrorOpen, setMirrorOpen, updateMirrorTarget } from '../mirror/mirrorPanel';
import { saveSettings, settings } from '../settings';
import { state } from '../state';
import { addTab } from '../tabs/tabStrip';
import { fileTimestamp } from '../util/text';
import { renderNotice } from '../view/status';
import { openFormatMenu, resetSettings, toggleWrap } from './formatMenu';
import { jumpToError, scrollToEnd } from './logView';
import { showMenu } from './menu';
import { toast } from './toast';

export function renderToolbar(): void {
  const t = state.active;
  els.pauseIcon.setAttribute('href', t.paused ? '#i-play' : '#i-pause');
  els.pause.title = t.paused ? 'Resume Logcat (Space)' : 'Pause Logcat (Space)';
  els.pause.classList.toggle('on', t.paused);
  els.wrap.classList.toggle('on', settings.wrap);
  const live = !t.file && !!t.device;
  const online = live && deviceOnline(t.device);
  els.restart.disabled = !live;
  els.shot.disabled = !online;
  // A running recording can always be stopped, even from a tab showing another device.
  const recording = isRecording();
  els.record.disabled = !online && !recording;
  els.record.classList.toggle('recording', recording);
  els.recordIcon.setAttribute('href', recording ? '#i-stop' : '#i-record');
  // A dot on both capture buttons shows that auto-save is on.
  const auto = isAutoSave();
  const autoHint = auto ? `\nAuto-save to ${captureFolder()} (right-click for options)` : '\nRight-click for auto-save options';
  els.shot.classList.toggle('auto-save', auto);
  els.record.classList.toggle('auto-save', auto);
  els.shot.title = 'Take Screenshot' + autoHint;
  els.record.title = (recording ? 'Stop Recording' : 'Record Screen') + autoHint;
}

/** Points the mirror panel at the active tab's device. */
export function syncMirror(): void {
  const t = state.hasActive ? state.active : null;
  const serial = t && !t.file ? t.device : '';
  updateMirrorTarget({ serial, label: serial ? deviceName(serial) : '', online: !!serial && deviceOnline(serial) });
  els.mirror.classList.toggle('on', isMirrorOpen());
}

async function clearLog(): Promise<void> {
  const t = state.active;
  t.reset();
  renderNotice();
  if (t.file || !t.device) return;
  try { await api.clear(t.device, settings.buffer); } catch (e) { toast('Clear failed: ' + (e as Error).message); }
}

export async function exportLog(): Promise<void> {
  const t = state.active;
  const text = t.view.map(exportLine).join('\n') + '\n';
  const base = t.file
    ? t.file.replace(/\.\w+$/, '') + '-filtered'
    : `logcat-${(t.device || 'device').replace(/[^\w.-]/g, '_')}-${fileTimestamp()}`;
  try {
    const saved = await api.saveFile(base + '.txt', text);
    if (saved) toast(`Saved ${t.view.length.toLocaleString()} lines to ${saved}`);
  } catch (e) {
    toast('Export failed: ' + (e as Error).message);
  }
}

export async function importLog(): Promise<void> {
  let res;
  try { res = await api.importFile(); } catch (e) { toast('Import failed: ' + (e as Error).message); return; }
  if (!res) return;
  const t = addTab({ name: res.name, file: res.name });
  t.ingest(res.lines);
  t.follow = false;
  els.log.scrollTop = 0;
  toast(`Imported ${t.entries.length.toLocaleString()} lines`);
}

function takeScreenshot(): void {
  const t = state.active;
  if (!t.device || t.file) return;
  if (isAutoSave()) void autoSaveScreenshot(t.device);
  else openScreenshotDialog(t.device);
}

function showCaptureMenu(ev: MouseEvent): void {
  ev.preventDefault();
  showMenu(ev.clientX, ev.clientY, captureMenuItems());
}

function toggleRecording(): void {
  if (isRecording()) { void stopRecording(); return; }
  const t = state.active;
  if (t.device && !t.file) startRecording(t.device);
}

function toggleMirror(): void {
  setMirrorOpen(!isMirrorOpen());
  settings.mirror = isMirrorOpen();
  saveSettings();
  syncMirror();
}

export function initToolbar(): void {
  els.clear.addEventListener('click', () => void clearLog());
  els.pause.addEventListener('click', () => state.active.setPaused(!state.active.paused));
  els.restart.addEventListener('click', () => state.active.restart());
  els.end.addEventListener('click', scrollToEnd);
  els.prev.addEventListener('click', () => jumpToError(-1));
  els.next.addEventListener('click', () => jumpToError(1));
  els.wrap.addEventListener('click', toggleWrap);
  els.importBtn.addEventListener('click', () => void importLog());
  els.exportBtn.addEventListener('click', () => void exportLog());
  els.format.addEventListener('click', openFormatMenu);
  els.shot.addEventListener('click', takeScreenshot);
  els.record.addEventListener('click', toggleRecording);
  els.shot.addEventListener('contextmenu', showCaptureMenu);
  els.record.addEventListener('contextmenu', showCaptureMenu);
  els.mirror.addEventListener('click', toggleMirror);

  api.onMenu('import', () => void importLog());
  api.onMenu('save', () => void exportLog());
  api.onMenu('resetSettings', () => void resetSettings());
}
