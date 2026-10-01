// Find in the active tab's messages (Ctrl+F). Unlike the filter, it keeps every line and highlights
// the matches; the find bar steps through them.

import { batch } from 'solid-js';
import { createMutable } from 'solid-js/store';
import type { LogEntry } from '../log/entry';
import { escapeRe } from '../util/text';
import type { Tab } from './Tab';

/** Find state; a Solid store, so the view and the find bar update when it changes. */
export const find = createMutable({
  open: false,
  text: '',
  caseSens: false,
  regex: false,
  /** Global regex used to highlight matches; null when the bar is closed, empty or invalid. */
  re: null as RegExp | null,
  invalid: false,
  /** Id of the current match, outlined in the view. */
  currentId: null as number | null,
});

let test: RegExp | null = null;

/** Matching ids for one tab's view, extended as lines stream in. */
let cache: { view: LogEntry[] | null; scanned: number; ids: number[] } = { view: null, scanned: 0, ids: [] };

export function setFind(opts: { text: string; caseSens: boolean; regex: boolean }): void {
  batch(() => apply(opts));
}

function apply(opts: { text: string; caseSens: boolean; regex: boolean }): void {
  Object.assign(find, opts);
  find.invalid = false;
  test = null;
  if (opts.text) {
    try {
      const src = opts.regex ? opts.text : escapeRe(opts.text);
      const flags = opts.caseSens ? '' : 'i';
      test = new RegExp(src, flags);
    } catch {
      find.invalid = true;
    }
  }
  find.re = test && find.open ? new RegExp(test.source, test.flags + 'g') : null;
  find.currentId = null;
  cache = { view: null, scanned: 0, ids: [] };
}

export function setFindOpen(open: boolean): void {
  find.open = open;
  setFind({ text: find.text, caseSens: find.caseSens, regex: find.regex });
}

/** Ids of the entries in `t.view` whose message matches, in order. */
export function matchIds(t: Tab): number[] {
  if (!test || !find.open) return [];
  // The view array is replaced when filters change or old lines are trimmed; otherwise it only grows.
  if (cache.view !== t.view) cache = { view: t.view, scanned: 0, ids: [] };
  const v = t.view;
  for (let i = cache.scanned; i < v.length; i++) {
    if (!v[i].marker && test.test(v[i].msg)) cache.ids.push(v[i].id);
  }
  cache.scanned = v.length;
  return cache.ids;
}

/** Index of the first id ≥ `id` in a sorted list of ids. */
export function firstIdAtLeast(ids: readonly number[], id: number): number {
  let lo = 0, hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ids[mid] < id) lo = mid + 1; else hi = mid;
  }
  return lo;
}
