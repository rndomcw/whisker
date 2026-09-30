// The vertical toolbar left of the log.

import { api } from '../api';
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
import { toast } from './toast';

export function renderToolbar(): void {
  const t = state.active;
  els.pauseIcon.setAttribute('href', t.paused ? '#i-play' : '#i-pause');
  els.pause.title = t.paused ? 'Resume Logcat (Space)' : 'Pause Logcat (Space)';
  els.pause.classList.toggle('on', t.paused);
  els.wrap.classList.toggle('on', settings.wrap);
  const live = !t.file && !!t.device;
  els.restart.disabled = !live;
  els.shot.disabled = !live || !deviceOnline(t.device);
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

async function takeScreenshot(): Promise<void> {
  const t = state.active;
  if (!t.device) return;
  try {
    const saved = await api.screenshot(t.device);
    if (saved) toast('Screenshot saved to ' + saved);
  } catch (e) {
    toast('Screenshot failed: ' + (e as Error).message);
  }
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
  els.shot.addEventListener('click', () => void takeScreenshot());
  els.mirror.addEventListener('click', toggleMirror);

  api.onMenu('import', () => void importLog());
  api.onMenu('save', () => void exportLog());
  api.onMenu('resetSettings', () => void resetSettings());
}
