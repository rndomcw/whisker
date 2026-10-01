// Things other parts of the UI do to the log view: scrolling, selection, copying and error jumps.

import { LEVEL_RANK } from '../../constants';
import { displayLine, type LogEntry } from '../../log/entry';
import { state } from '../../state/app';
import type { Tab } from '../../state/Tab';
import { toast } from '../../state/toast';
import { firstIndexAtLeast } from '../../util/search';
import { indexAtY, rowTop } from '../../view/layout';
import { ROW_H } from '../../constants';

/** The scroll container, set by LogView. */
let logEl: HTMLElement | null = null;

export function setLogElement(el: HTMLElement): void {
  logEl = el;
}

export function focusLog(): void {
  logEl?.focus();
}

export function scrollToEnd(): void {
  state.active.follow = true;
}

export function scrollToStart(): void {
  state.active.follow = false;
  if (logEl) logEl.scrollTop = 0;
}

/** Index of the row at the top of the view. */
export function topIndex(t: Tab): number {
  return logEl ? indexAtY(t, logEl.scrollTop) : 0;
}

/** Scrolls row `i` into view (a third from the top) unless it is already visible. */
export function reveal(t: Tab, i: number, always = false): void {
  if (!logEl) return;
  const top = rowTop(t, i);
  const h = logEl.clientHeight;
  if (always || top < logEl.scrollTop || top + ROW_H > logEl.scrollTop + h) {
    t.follow = false;
    logEl.scrollTop = top - h / 3;
  }
}

export function selectedEntries(): LogEntry[] {
  const t = state.active;
  return t.view.filter(e => t.selected.has(e.id));
}

export function selectAll(): void {
  const t = state.active;
  for (const e of t.view) t.selected.add(e.id);
  t.selectionChanged();
}

export function clearSelection(): void {
  const t = state.active;
  t.selected.clear();
  t.anchorId = null;
  t.selectionChanged();
}

/** Selects only `e`, making it the anchor for Shift-click. */
export function selectOnly(t: Tab, e: LogEntry): void {
  t.selected.clear();
  t.selected.add(e.id);
  t.anchorId = e.id;
  t.selectionChanged();
}

export async function copyText(text: string): Promise<void> {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { toast('Copy failed'); }
}

export function copySelection(): void {
  const t = state.active;
  void copyText(selectedEntries().map(e => displayLine(t, e)).join('\n'));
}

/** Selects the previous/next error-or-worse line and scrolls to it. */
export function jumpToError(dir: 1 | -1): void {
  const t = state.active, v = t.view;
  if (!v.length) return;
  let i = t.anchorId !== null ? firstIndexAtLeast(v, t.anchorId) : (dir < 0 ? v.length : topIndex(t) - 1);
  for (i += dir; i >= 0 && i < v.length; i += dir) {
    if (!v[i].marker && LEVEL_RANK[v[i].lvl] >= LEVEL_RANK.E) break;
  }
  if (i < 0 || i >= v.length) { toast(dir < 0 ? 'No earlier errors' : 'No later errors'); return; }
  selectOnly(t, v[i]);
  reveal(t, i, true);
}
