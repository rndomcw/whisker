// Formatting options (columns, soft-wrap, log buffer) and resetting all settings.

import { api } from '../api';
import { captureMenuItems } from '../capture/captureSettings';
import { BUFFERS, COLW } from '../constants';
import { els } from '../dom';
import { type FormatSettings, resetAndReload, saveSettings, settings } from '../settings';
import { state } from '../state';
import { invalidateLayout, metrics } from '../view/layout';
import { queueRender } from '../view/render';
import { showMenu } from './menu';
import { renderToolbar } from './toolbar';

/** Applies column visibility and soft-wrap to the log view. */
export function applyFormat(): void {
  const f = settings.format;
  const root = document.documentElement.style;
  root.setProperty('--w-time', (f.date ? COLW.date : COLW.time) + 'ch');
  root.setProperty('--w-pid', COLW.pid + 'ch');
  root.setProperty('--w-tag', COLW.tag + 'ch');
  root.setProperty('--w-pkg', COLW.pkg + 'ch');
  root.setProperty('--w-lvl', COLW.lvl + 'ch');
  els.log.classList.toggle('hide-pid', !f.pid);
  els.log.classList.toggle('hide-tag', !f.tag);
  els.log.classList.toggle('hide-pkg', !f.pkg);
  els.log.classList.toggle('wrap', settings.wrap);
  metrics.key = '';
  invalidateLayout();
  if (state.hasActive) { renderToolbar(); queueRender(); }
}

export function toggleWrap(): void {
  settings.wrap = !settings.wrap;
  applyFormat();
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

export function openFormatMenu(): void {
  const f = settings.format;
  const set = (patch: Partial<FormatSettings>) => { Object.assign(settings.format, patch); applyFormat(); saveSettings(); };
  const standard = f.date && f.pid && f.tag && f.pkg;
  const compact = !f.date && !f.pid && f.tag && !f.pkg;
  const r = els.format.getBoundingClientRect();
  showMenu(r.right + 4, r.top, [
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
    { header: 'Screenshots & Recordings' },
    ...captureMenuItems(),
    '-',
    { label: 'Reset All Settings…', action: () => void resetSettings() },
  ]);
}
