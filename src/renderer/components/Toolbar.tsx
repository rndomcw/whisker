// The vertical toolbar left of the log, and the commands behind it.

import { api } from '../api';
import { BUFFERS } from '../constants';
import { exportLine } from '../log/entry';
import { state } from '../state/app';
import { autoSaveScreenshot, captureFolder, captureMenuItems, isAutoSave } from '../state/capture';
import { deviceOnline } from '../state/devices';
import { type MenuItem, showMenu, toggleMenuBelow } from '../state/menu';
import { isRecording, startRecording, stopRecording } from '../state/recorder';
import { type FormatSettings, resetAndReload, saveSettings, settings } from '../state/settings';
import { addTab } from '../state/tabActions';
import { toast } from '../state/toast';
import { fileTimestamp } from '../util/text';
import { invalidateLayout } from '../view/layout';
import { openScreenshotDialog } from './capture/ScreenshotDialog';
import { cx, IconButton, Separator } from './ui';
import { jumpToError, scrollToEnd, scrollToStart } from './log/actions';
import { setMirrorOpen } from './mirror/MirrorPanel';

export function toggleWrap(): void {
  settings.wrap = !settings.wrap;
  invalidateLayout();
  saveSettings();
}

export async function resetSettings(): Promise<void> {
  const ok = await api.confirm({
    message: 'Reset all settings?',
    detail: 'Tabs, filters, package/process selections, favorites, filter history, display options and the mirror panel ' +
      'go back to their defaults. Logs on the device are not affected.',
    ok: 'Reset',
  });
  if (ok) resetAndReload();
}

async function clearLog(): Promise<void> {
  const t = state.active;
  t.reset();
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
  scrollToStart();
  toast(`Imported ${t.entries.length.toLocaleString()} lines`);
}

function formatMenuItems(): MenuItem[] {
  const f = settings.format;
  const set = (patch: Partial<FormatSettings>) => { Object.assign(settings.format, patch); saveSettings(); };
  const standard = f.date && f.pid && f.tag && f.pkg;
  const compact = !f.date && !f.pid && f.tag && !f.pkg;
  return [
    { label: 'Standard View', checked: standard, action: () => set({ date: true, pid: true, tag: true, pkg: true }) },
    { label: 'Compact View', checked: compact, action: () => set({ date: false, pid: false, tag: true, pkg: false }) },
    '-',
    { label: 'Show Date', checked: f.date, action: () => set({ date: !f.date }) },
    { label: 'Show Process and Thread IDs', checked: f.pid, action: () => set({ pid: !f.pid }) },
    { label: 'Show Tag', checked: f.tag, action: () => set({ tag: !f.tag }) },
    { label: 'Show Package Name', checked: f.pkg, action: () => set({ pkg: !f.pkg }) },
    '-',
    { header: 'Log Buffer' },
    ...BUFFERS.map(b => ({
      label: b === 'default' ? 'Default (main, system, crash)' : b,
      checked: settings.buffer === b,
      action: () => {
        settings.buffer = b;
        saveSettings();
        for (const t of state.tabs) if (!t.file && t.device) t.restart();
      },
    })),
    '-',
    { label: 'Reset All Settings…', action: () => void resetSettings() },
  ];
}

function takeScreenshot(): void {
  const t = state.active;
  if (!t.device || t.file) return;
  if (isAutoSave()) void autoSaveScreenshot(t.device);
  else openScreenshotDialog(t.device);
}

function toggleRecording(): void {
  if (isRecording()) { void stopRecording(); return; }
  const t = state.active;
  if (t.device && !t.file) startRecording(t.device);
}

function showCaptureMenu(ev: MouseEvent): void {
  ev.preventDefault();
  showMenu(ev.clientX, ev.clientY, captureMenuItems());
}

export function Toolbar() {
  const t = () => state.active;
  const live = () => !t().file && !!t().device;
  const online = () => live() && deviceOnline(t().device);
  const autoHint = () => (isAutoSave() ? `\nAuto-save to ${captureFolder()} (right-click for options)` : '\nRight-click for auto-save options');

  return (
    <nav class="flex w-10 flex-none flex-col items-center gap-1 border-r border-line bg-bg py-1.5">
      <IconButton icon="trash" title="Clear Logcat" onClick={() => void clearLog()} />
      <IconButton icon={t().paused ? 'play' : 'pause'} on={t().paused} title={t().paused ? 'Resume Logcat (Space)' : 'Pause Logcat (Space)'}
        onClick={() => t().setPaused(!t().paused)} />
      <IconButton icon="restart" title="Restart Logcat" disabled={!live()} onClick={() => t().restart()} />
      <IconButton icon="end" title="Scroll to End (End)" onClick={scrollToEnd} />
      <IconButton icon="up" title="Previous Error" onClick={() => jumpToError(-1)} />
      <IconButton icon="down" title="Next Error" onClick={() => jumpToError(1)} />
      <Separator />
      <IconButton icon="wrap" on={settings.wrap} title="Soft-Wrap" onClick={toggleWrap} />
      <IconButton icon="import" title="Import Logcat from File (Ctrl+O)" onClick={() => void importLog()} />
      <IconButton icon="export" title="Export Logcat to File (Ctrl+S)" onClick={() => void exportLog()} />
      <IconButton icon="settings" title="Configure Logcat Formatting Options" onClick={ev => toggleMenuBelow(ev.currentTarget, formatMenuItems)} />
      <Separator />
      <IconButton id="btnShot" icon="camera" title={'Take Screenshot' + autoHint()} disabled={!online()}
        onClick={takeScreenshot} onContextMenu={showCaptureMenu} />
      {/* A running recording can always be stopped, even from a tab showing another device. */}
      <IconButton id="btnRecord" icon={isRecording() ? 'stop' : 'record'}
        class={cx('record-btn', isRecording() && 'recording')}
        tone={isRecording() ? 'bg-rec/18 text-rec' : undefined}
        title={(isRecording() ? 'Stop Recording' : 'Record Screen') + autoHint()}
        disabled={!online() && !isRecording()} onClick={toggleRecording} onContextMenu={showCaptureMenu} />
      <IconButton icon="mirror" on={settings.mirror} title="Device Mirroring" onClick={() => setMirrorOpen(!settings.mirror)} />
    </nav>
  );
}
