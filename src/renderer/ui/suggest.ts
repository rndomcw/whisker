// Autocomplete for the filter query: keys (tag:, package:, …) and their values.

import { PKG_RE } from '../constants';
import { els } from '../dom';
import { QUERY_KEYS } from '../query/compile';
import { state } from '../state';
import { esc, quoteIfNeeded } from '../util/text';
import { applyQuery, commitHistory, scheduleApply } from './queryBar';

const KEY_HINTS: [string, string][] = [
  ['tag', 'Log tag'], ['package', 'App package'], ['process', 'Process name'], ['message', 'Log message'],
  ['line', 'Whole log line'], ['level', 'Minimum log level'], ['age', 'Recent lines, e.g. 5m'], ['is', 'crash / stacktrace'],
];

interface Suggestion {
  label: string;
  hint?: string;
  insert: string;
  /** Show value suggestions right after inserting a key. */
  reopen?: boolean;
}

interface TokenAtCaret {
  start: number;
  end: number;
  text: string;
}

let current: { tok: TokenAtCaret; items: Suggestion[]; index: number } | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function currentToken(): TokenAtCaret {
  const v = els.query.value;
  const end = els.query.selectionStart ?? v.length;
  let start = end;
  while (start > 0 && !/[\s()|&]/.test(v[start - 1])) start--;
  return { start, end, text: v.slice(start, end) };
}

function valuesFor(key: string): string[] {
  const t = state.active;
  const ds = t.ds;
  const running = [...ds.running].map(pid => ds.names.get(pid)).filter((n): n is string => !!n);
  switch (key) {
    case 'tag': return [...t.tagCounts].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
    case 'package': {
      const apps = ds.apps.size ? [...ds.apps].map(pid => ds.names.get(pid)).filter((n): n is string => !!n) : running;
      const pkgs = new Set(apps.map(n => n.split(':')[0]).filter(n => PKG_RE.test(n)));
      return ['mine', ...[...pkgs].sort()];
    }
    case 'process': return [...new Set(running)].sort();
    case 'level': return ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'ASSERT'];
    case 'is': return ['crash', 'stacktrace'];
    case 'age': return ['30s', '1m', '5m', '15m', '1h', '1d'];
    default: return [];
  }
}

/** Shows suggestions for the token at the caret; `force` lists all keys for an empty token (Ctrl+Space). */
export function updateSuggest(force = false): void {
  const tok = currentToken();
  let items: Suggestion[] = [];
  const m = /^(-?)([a-z]+)(=:|~:|:)(.*)$/i.exec(tok.text);
  if (m && QUERY_KEYS.includes(m[2].toLowerCase())) {
    const prefix = m[1] + m[2] + m[3];
    const typed = m[4].replace(/^"/, '').toLowerCase();
    items = valuesFor(m[2].toLowerCase())
      .filter(v => v.toLowerCase().includes(typed) && v.toLowerCase() !== typed)
      .slice(0, 40)
      .map(v => ({ label: v, insert: prefix + quoteIfNeeded(v) + ' ' }));
  } else if (/^-?[a-z]*$/i.test(tok.text) && (tok.text || force)) {
    const neg = tok.text.startsWith('-') ? '-' : '';
    const w = tok.text.replace(/^-/, '').toLowerCase();
    items = KEY_HINTS.filter(([k]) => k.startsWith(w) && k !== w)
      .map(([k, hint]) => ({ label: neg + k + ':', hint, insert: neg + k + ':', reopen: true }));
  }
  if (!items.length) { hideSuggest(); return; }
  current = { tok, items, index: 0 };
  els.suggest.innerHTML = items.map((it, i) =>
    `<div class="item${i === 0 ? ' active' : ''}" data-i="${i}"><span class="label">${esc(it.label)}</span>` +
    (it.hint ? `<span class="hint">${esc(it.hint)}</span>` : '') + '</div>').join('');
  els.suggest.hidden = false;
  // Place the popup under the token being completed.
  const r = els.query.getBoundingClientRect();
  measureCtx ??= document.createElement('canvas').getContext('2d');
  let x = r.left + 4 - els.query.scrollLeft;
  if (measureCtx) {
    measureCtx.font = getComputedStyle(els.query).font;
    x += measureCtx.measureText(els.query.value.slice(0, tok.start)).width;
  }
  els.suggest.style.left = Math.max(4, Math.min(x, innerWidth - els.suggest.offsetWidth - 4)) + 'px';
  els.suggest.style.top = r.bottom + 6 + 'px';
}

export function hideSuggest(): void {
  current = null;
  els.suggest.hidden = true;
}

function moveSuggest(d: number): void {
  if (!current) return;
  const s = current;
  s.index = (s.index + d + s.items.length) % s.items.length;
  els.suggest.querySelectorAll('.item').forEach((e, i) => e.classList.toggle('active', i === s.index));
  els.suggest.children[s.index]?.scrollIntoView({ block: 'nearest' });
}

function acceptSuggest(i = current?.index ?? 0): void {
  if (!current) return;
  const { tok, items } = current;
  const it = items[i];
  const v = els.query.value;
  const after = v.slice(tok.end).replace(/^\S*/, '');
  els.query.value = v.slice(0, tok.start) + it.insert + after.replace(/^\s+/, it.insert.endsWith(' ') ? '' : ' ');
  const caret = tok.start + it.insert.length;
  els.query.setSelectionRange(caret, caret);
  hideSuggest();
  scheduleApply(50);
  els.queryClear.hidden = false;
  if (it.reopen) updateSuggest();
}

export function initSuggest(): void {
  els.suggest.addEventListener('mousedown', ev => {
    ev.preventDefault(); // keep focus in the query box
    const item = (ev.target as Element).closest<HTMLElement>('.item');
    if (item) acceptSuggest(Number(item.dataset.i));
  });

  els.query.addEventListener('keydown', ev => {
    if (ev.key === ' ' && ev.ctrlKey) { ev.preventDefault(); updateSuggest(true); return; }
    if (current) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); moveSuggest(1); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moveSuggest(-1); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acceptSuggest(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); hideSuggest(); return; }
    }
    if (ev.key === 'Enter') { applyQuery(); commitHistory(); }
  });
  els.query.addEventListener('click', () => { if (current) updateSuggest(); });
}
