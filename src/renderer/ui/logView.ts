// Interaction with the log rows: following, selection, copying, the context menu and error jumps.

import { LEVEL_RANK, PKG_RE, ROW_H } from '../constants';
import { els } from '../dom';
import { displayLine, type LogEntry, procOf } from '../log/entry';
import { type ProcSel, sameProc } from '../log/processes';
import { state } from '../state';
import { firstIndexAtLeast } from '../util/search';
import { messageTerm, quoteIfNeeded } from '../util/text';
import { indexAtY, rowTop } from '../view/layout';
import { queueRender } from '../view/render';
import { type MenuItem, showMenu } from './menu';
import { addQueryTerm } from './queryBar';
import { toast } from './toast';

export function scrollToEnd(): void {
  state.active.follow = true;
  queueRender();
}

export function scrollToStart(): void {
  state.active.follow = false;
  els.log.scrollTop = 0;
}

export function selectedEntries(): LogEntry[] {
  const t = state.active;
  return t.view.filter(e => t.selected.has(e.id));
}

export function selectAll(): void {
  const t = state.active;
  for (const e of t.view) t.selected.add(e.id);
  queueRender();
}

export function clearSelection(): void {
  const t = state.active;
  t.selected.clear();
  t.anchorId = null;
  queueRender();
}

async function copyText(text: string): Promise<void> {
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
  let i = t.anchorId !== null ? firstIndexAtLeast(v, t.anchorId) : (dir < 0 ? v.length : indexAtY(t, els.log.scrollTop) - 1);
  for (i += dir; i >= 0 && i < v.length; i += dir) {
    if (!v[i].marker && LEVEL_RANK[v[i].lvl] >= LEVEL_RANK.E) break;
  }
  if (i < 0 || i >= v.length) { toast(dir < 0 ? 'No earlier errors' : 'No later errors'); return; }
  t.selected.clear();
  t.selected.add(v[i].id);
  t.anchorId = v[i].id;
  t.follow = false;
  els.log.scrollTop = rowTop(t, i) - els.log.clientHeight / 3;
  queueRender();
}

function entryAt(target: EventTarget | null): LogEntry | null {
  const row = (target as Element | null)?.closest<HTMLElement>('.row');
  if (!row) return null;
  const t = state.active;
  const id = Number(row.dataset.id);
  const e = t.view[firstIndexAtLeast(t.view, id)];
  return e && e.id === id ? e : null;
}

function onRowMouseDown(ev: MouseEvent): void {
  if (ev.button !== 0) return;
  const e = entryAt(ev.target);
  if (!e) return;
  const t = state.active;
  if (ev.shiftKey && t.anchorId !== null) {
    const a = firstIndexAtLeast(t.view, Math.min(t.anchorId, e.id));
    const b = firstIndexAtLeast(t.view, Math.max(t.anchorId, e.id));
    if (!(ev.ctrlKey || ev.metaKey)) t.selected.clear();
    for (let i = a; i <= b && i < t.view.length; i++) t.selected.add(t.view[i].id);
  } else if (ev.ctrlKey || ev.metaKey) {
    if (t.selected.has(e.id)) t.selected.delete(e.id); else t.selected.add(e.id);
    t.anchorId = e.id;
  } else {
    t.selected.clear();
    t.selected.add(e.id);
    t.anchorId = e.id;
  }
  t.follow = false; // keep the clicked line in place
  els.log.focus();
  queueRender();
}

function onRowContextMenu(ev: MouseEvent): void {
  ev.preventDefault();
  const e = entryAt(ev.target);
  if (!e) return;
  const t = state.active;
  if (!t.selected.has(e.id)) {
    t.selected.clear();
    t.selected.add(e.id);
    t.anchorId = e.id;
    queueRender();
  }
  const proc = procOf(t, e);
  const pkg = proc.split(':')[0];
  const items: MenuItem[] = [
    { label: 'Copy', hint: 'Ctrl+C', action: copySelection },
    {
      label: 'Copy Message',
      disabled: !!e.marker,
      action: () => void copyText(selectedEntries().filter(x => !x.marker).map(x => x.msg).join('\n')),
    },
  ];
  if (!e.marker && e.tag) {
    items.push('-',
      { label: `Filter tag: ${e.tag}`, action: () => addQueryTerm('tag:' + quoteIfNeeded(e.tag)) },
      { label: `Exclude tag: ${e.tag}`, action: () => addQueryTerm('-tag:' + quoteIfNeeded(e.tag)) });
    const text = messageTerm(e.msg);
    if (text) {
      items.push({
        label: `Exclude message: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`,
        action: () => addQueryTerm('-message:' + quoteIfNeeded(text)),
      });
    }
  }
  if (pkg) {
    const kind = PKG_RE.test(pkg) ? 'package' : 'process';
    const p: ProcSel = { kind, value: kind === 'package' ? pkg : proc };
    const selected = t.procSel.some(x => sameProc(x, p));
    items.push('-', { label: `Show only ${kind}: ${p.value}`, action: () => t.setProcSel([p]) });
    if (t.procSel.length && !selected) items.push({ label: `Add ${kind} to selection: ${p.value}`, action: () => t.toggleProc(p) });
    if (selected && t.procSel.length > 1) items.push({ label: `Remove ${kind} from selection: ${p.value}`, action: () => t.toggleProc(p) });
    items.push({ label: `Exclude ${kind}: ${p.value}`, action: () => addQueryTerm(`-${kind}:${quoteIfNeeded(p.value)}`) });
  }
  items.push('-', { label: 'Select All', hint: 'Ctrl+A', action: selectAll });
  showMenu(ev.clientX, ev.clientY, items);
}

export function initLogView(): void {
  els.log.addEventListener('scroll', () => {
    state.active.follow = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - ROW_H;
    queueRender();
  });
  new ResizeObserver(() => queueRender()).observe(els.log);
  els.follow.addEventListener('click', scrollToEnd);
  els.rows.addEventListener('mousedown', onRowMouseDown);
  els.rows.addEventListener('contextmenu', onRowContextMenu);
}
