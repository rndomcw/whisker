// The filter query box: live filtering, autocomplete, case toggle, favorites, history and the syntax help.

import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { PKG_RE } from '../../constants';
import { QUERY_KEYS } from '../../query/compile';
import { state } from '../../state/app';
import { type MenuItem, showMenu, toggleMenuBelow } from '../../state/menu';
import {
  applyQuery, clearHistory, commitHistory, isFavorite, queryText, removeFavorite, scheduleApply, setQuery, setQueryText,
  toggleCase, toggleFavorite,
} from '../../state/query';
import { settings } from '../../state/settings';
import { quoteIfNeeded } from '../../util/text';
import { Icon } from '../Icon';
import { cx, IconButton, menuBox, menuHint, menuItem, menuLabel, queryField, queryInput, TextToggle } from '../ui';

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

interface Suggest {
  tok: TokenAtCaret;
  items: Suggestion[];
  index: number;
  x: number;
  y: number;
}

/** The query box element, for Ctrl+L. */
let queryEl: HTMLInputElement | undefined;

export function focusQuery(): void {
  queryEl?.focus();
  queryEl?.select();
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

function QueryHelp() {
  const rows: [string[], string][] = [
    [['tag:Foo'], 'Tag contains Foo'],
    [['tag=:Foo'], 'Tag is exactly Foo'],
    [['tag~:^Foo.*'], 'Tag matches a regex'],
    [['-tag:Foo'], 'Exclude (works with any key)'],
    [['package:com.example'], 'Package (use package:mine for installed apps)'],
    [['process:', 'message:', 'line:'], 'Process name, message text, whole line'],
    [['level:WARN'], 'Minimum level (V, D, I, W, E, A)'],
    [['age:5m'], 'Newer than 30s, 5m, 2h, 1d…'],
    [['is:crash', 'is:stacktrace'], 'Crashes, stack-trace lines'],
    [['some text'], 'Free text in tag, package or message'],
    [['a | b', 'a & b', '( )'], 'Or, and, grouping. Terms are AND-ed; repeated keys like tag:a tag:b are OR-ed'],
    [['"quoted text"'], 'Values with spaces or special characters'],
  ];
  return (
    <div class="select-text px-2.5 py-2">
      <div class="mb-2 font-semibold">Logcat query syntax</div>
      <table class="border-collapse">
        <For each={rows}>
          {([codes, text]) => (
            <tr>
              <td class="py-[3px] pr-[14px] align-top">
                <For each={codes}>{(c, i) => <>{i() ? ' ' : ''}<code class="font-code text-debug">{c}</code></>}</For>
              </td>
              <td class="py-[3px] pr-[14px] align-top">{text}</td>
            </tr>
          )}
        </For>
      </table>
    </div>
  );
}

function filterMenuItems(): MenuItem[] {
  const items: MenuItem[] = [];
  if (settings.favorites.length) {
    items.push({ header: 'Favorites' });
    for (const f of settings.favorites) items.push({ label: f, action: () => setQuery(f), remove: () => removeFavorite(f) });
  }
  const history = settings.history.filter(h => !settings.favorites.includes(h));
  if (history.length) {
    if (items.length) items.push('-');
    items.push({ header: 'History' });
    for (const h of history) items.push({ label: h, action: () => setQuery(h) });
    items.push('-', { label: 'Clear History', action: clearHistory });
  }
  if (!items.length) items.push({ label: 'No saved or recent filters', disabled: true });
  return items;
}

export function QueryBar() {
  let input!: HTMLInputElement;
  let suggestEl: HTMLDivElement | undefined;
  let measureCtx: CanvasRenderingContext2D | null = null;
  const [suggest, setSuggest] = createSignal<Suggest | null>(null);

  // The box shows the active tab's query.
  createEffect(on(() => state.active, t => { setQueryText(t.query); setSuggest(null); }));

  function currentToken(): TokenAtCaret {
    const v = input.value;
    const end = input.selectionStart ?? v.length;
    let start = end;
    while (start > 0 && !/[\s()|&]/.test(v[start - 1])) start--;
    return { start, end, text: v.slice(start, end) };
  }

  /** Shows suggestions for the token at the caret; `force` lists all keys for an empty token (Ctrl+Space). */
  function updateSuggest(force = false): void {
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
    if (!items.length) { setSuggest(null); return; }
    // Place the popup under the token being completed.
    const r = input.getBoundingClientRect();
    measureCtx ??= document.createElement('canvas').getContext('2d');
    let x = r.left + 4 - input.scrollLeft;
    if (measureCtx) {
      measureCtx.font = getComputedStyle(input).font;
      x += measureCtx.measureText(input.value.slice(0, tok.start)).width;
    }
    setSuggest({ tok, items, index: 0, x, y: r.bottom + 6 });
    // Keep it inside the window once its width is known.
    if (suggestEl) suggestEl.style.left = Math.max(4, Math.min(x, innerWidth - suggestEl.offsetWidth - 4)) + 'px';
  }

  function moveSuggest(d: number): void {
    const s = suggest();
    if (!s) return;
    const index = (s.index + d + s.items.length) % s.items.length;
    setSuggest({ ...s, index });
    suggestEl?.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function acceptSuggest(i = suggest()?.index ?? 0): void {
    const s = suggest();
    if (!s) return;
    const { tok, items } = s;
    const it = items[i];
    const v = input.value;
    const after = v.slice(tok.end).replace(/^\S*/, '');
    const next = v.slice(0, tok.start) + it.insert + after.replace(/^\s+/, it.insert.endsWith(' ') ? '' : ' ');
    input.value = next;
    setQueryText(next);
    const caret = tok.start + it.insert.length;
    input.setSelectionRange(caret, caret);
    setSuggest(null);
    scheduleApply(50);
    if (it.reopen) updateSuggest();
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === ' ' && ev.ctrlKey) { ev.preventDefault(); updateSuggest(true); return; }
    if (suggest()) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); moveSuggest(1); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moveSuggest(-1); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acceptSuggest(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setSuggest(null); return; }
    }
    if (ev.key === 'Enter') { applyQuery(); commitHistory(); }
  }

  const fav = () => isFavorite(state.active.query);

  return (
    <>
      <div class={cx(queryField(!!state.active.filter.error), 'min-w-[200px] flex-1 pl-[3px]')} title={state.active.filter.error}>
        <IconButton small icon="funnel" title="Filter history and favorites" onClick={ev => toggleMenuBelow(ev.currentTarget, filterMenuItems)} />
        <input
          id="query"
          class={queryInput}
          ref={el => { input = el; queryEl = el; }}
          spellcheck={false}
          autocomplete="off"
          placeholder="Press Ctrl+Space to see suggestions"
          value={queryText()}
          onInput={ev => { setQueryText(ev.currentTarget.value); scheduleApply(150); updateSuggest(); }}
          onKeyDown={onKeyDown}
          onClick={() => { if (suggest()) updateSuggest(); }}
          onBlur={() => { commitHistory(); setTimeout(() => setSuggest(null), 150); }}
        />
        <Show when={queryText()}>
          <IconButton small icon="close" title="Clear filter" onClick={() => { setQuery(''); input.focus(); }} />
        </Show>
        <TextToggle on={state.active.caseSens} title="Match case" onClick={toggleCase}>Cc</TextToggle>
        <IconButton small icon="star" on={fav()} class={fav() ? '[&_svg]:fill-star [&_svg]:stroke-star' : ''}
          title={fav() ? 'Remove filter from favorites' : 'Add filter to favorites'} onClick={toggleFavorite} />
      </div>
      <IconButton icon="help" title="Query syntax" onClick={ev => {
        const r = ev.currentTarget.getBoundingClientRect();
        showMenu(r.right - 620, r.bottom + 4, [{ content: () => <QueryHelp /> }], 'help');
      }} />
      <Show when={suggest()}>
        {s => (
          <div class={menuBox('suggest')} ref={suggestEl} style={{ left: `${s().x}px`, top: `${s().y}px` }}
            onMouseDown={ev => {
              ev.preventDefault(); // keep focus in the query box
              const item = (ev.target as Element).closest<HTMLElement>('[data-i]');
              if (item) acceptSuggest(Number(item.dataset.i));
            }}>
            <For each={s().items}>
              {(it, i) => (
                <div class={menuItem({ active: i() === s().index, indent: 'wide' })} data-i={i()}>
                  <span class={menuLabel}>{it.label}</span>
                  <Show when={it.hint}><span class={menuHint(i() === s().index)}>{it.hint}</span></Show>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </>
  );
}
