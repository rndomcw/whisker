// Row geometry for the virtualized log view: fixed-height rows, or variable heights when soft-wrapping.

import { COLW, ROW_H } from '../constants';
import { els } from '../dom';
import type { LogEntry } from '../log/entry';
import { settings } from '../settings';
import { state } from '../state';
import type { Tab } from '../tabs/Tab';

export const metrics = {
  /** Width + format the values below were computed for. */
  key: '',
  charW: 7.5,
  /** Characters per wrapped message line. */
  cpl: 100,
};

/** Recomputes the wrap width when the view size or visible columns change. */
export function measure(): void {
  const w = els.log.clientWidth;
  const f = settings.format;
  const key = `${w}|${f.date}|${f.pid}|${f.tag}|${f.pkg}`;
  if (key === metrics.key) return;
  metrics.key = key;
  metrics.charW = els.probe.getBoundingClientRect().width / 100 || 7.5;
  const prefix = (f.date ? COLW.date : COLW.time) + (f.pid ? COLW.pid : 0) + (f.tag ? COLW.tag : 0) +
    (f.pkg ? COLW.pkg : 0) + COLW.lvl;
  metrics.cpl = Math.max(20, Math.floor((w - 16) / metrics.charW) - prefix);
  document.documentElement.style.setProperty('--cpl', String(metrics.cpl));
  invalidateLayout();
}

/** Forgets cached row tops, e.g. after the wrap width or soft-wrap setting changed. */
export function invalidateLayout(): void {
  for (const t of state.tabs) t.tops = null;
}

/** Lines a row takes; messages wrap at exactly `cpl` characters (monospace, break-all). */
export function rowLines(e: LogEntry): number {
  return !settings.wrap || e.marker ? 1 : Math.max(1, Math.ceil(e.msg.length / metrics.cpl));
}

/** Extends the cached row tops to cover newly appended view entries. */
export function ensureLayout(t: Tab): void {
  if (!settings.wrap) return;
  const tops = t.tops ?? (t.tops = [0]);
  for (let i = tops.length - 1; i < t.view.length; i++) tops.push(tops[i] + rowLines(t.view[i]) * ROW_H);
}

export function rowTop(t: Tab, i: number): number {
  if (!settings.wrap) return i * ROW_H;
  ensureLayout(t);
  return t.tops![i];
}

/** Index of the row at content offset y. */
export function indexAtY(t: Tab, y: number): number {
  if (!settings.wrap) return Math.floor(y / ROW_H);
  ensureLayout(t);
  const tops = t.tops!;
  let lo = 0, hi = t.view.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return lo;
}
