// Draws the visible rows of the active tab (the list is virtualized).

import { ROW_H, TAG_COLORS } from '../constants';
import { els } from '../dom';
import { type LogEntry, markerText, procOf } from '../log/entry';
import { settings } from '../settings';
import { state } from '../state';
import type { Tab } from '../tabs/Tab';
import { esc } from '../util/text';
import { find } from './find';
import { updateHover } from './hover';
import { ensureLayout, indexAtY, measure, rowLines, rowTop } from './layout';
import { renderEmpty } from './status';

let renderQueued = false;
/** Called after each render, e.g. to update the find bar's match count. */
let onRendered: () => void = () => {};

export function setOnRendered(fn: () => void): void {
  onRendered = fn;
}

/** Renders on the next animation frame; many updates per frame cost one render. */
export function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

const tagClassCache = new Map<string, string>();

/** A stable color class per tag, like Android Studio's tag colors. */
function tagClass(tag: string): string {
  let c = tagClassCache.get(tag);
  if (c === undefined) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
    c = 't' + (Math.abs(h) % TAG_COLORS);
    tagClassCache.set(tag, c);
  }
  return c;
}

// While the find bar is open, its matches are highlighted instead of the filter's.
function highlight(t: Tab, s: string): string {
  const re = find.re ?? t.filter.hl;
  if (!re) return esc(s);
  let out = '', last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

function rowHtml(t: Tab, e: LogEntry): string {
  const sel = (t.selected.has(e.id) ? ' sel' : '') + (find.currentId === e.id ? ' find-cur' : '');
  if (e.marker) {
    return `<div class="row marker${e.raw ? '' : ' proc'}${sel}" data-id="${e.id}">${esc(markerText(e))}</div>`;
  }
  const lines = rowLines(e);
  const style = lines > 1 ? ` style="height:${lines * ROW_H}px"` : '';
  const proc = esc(procOf(t, e));
  const tag = esc(e.tag);
  return `<div class="row L${e.lvl}${sel}" data-id="${e.id}"${style}>` +
    `<span class="c-time">${settings.format.date ? e.date + ' ' : ''}${e.time}</span>` +
    `<span class="c-pid">${e.pid}-${e.tid}</span>` +
    `<span class="c-tag ${tagClass(e.tag)}" title="${tag}">${tag}</span>` +
    `<span class="c-pkg" title="${proc}">${proc}</span>` +
    `<span class="c-lvl"><b>${e.lvl}</b></span>` +
    `<span class="c-msg">${highlight(t, e.msg)}</span></div>`;
}

export function render(): void {
  renderQueued = false;
  if (!state.hasActive) return;
  const t = state.active;
  measure();
  const n = t.view.length;
  ensureLayout(t);
  els.spacer.style.height = rowTop(t, n) + 'px';
  if (t.follow) els.log.scrollTop = els.log.scrollHeight;
  const top = els.log.scrollTop;
  const bottom = top + els.log.clientHeight + 4 * ROW_H;
  const start = Math.max(0, Math.min(n, indexAtY(t, top)) - 4);
  let end = start;
  while (end < n && rowTop(t, end) < bottom) end++;
  let html = '';
  for (let i = start; i < end; i++) html += rowHtml(t, t.view[i]);
  els.rows.style.transform = `translateY(${rowTop(t, start)}px)`;
  els.rows.innerHTML = html;
  updateHover();
  els.follow.hidden = t.follow || n === 0;
  renderEmpty();
  onRendered();
}
