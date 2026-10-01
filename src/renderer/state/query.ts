// The filter query box: its text, applying it to the active tab, favorites and history.

import { createSignal } from 'solid-js';
import { state } from './app';
import { saveSettings, settings } from './settings';

/** The text in the query box; applied to the active tab shortly after typing stops. */
const [text, setText] = createSignal('');
export const queryText = text;
export const setQueryText = setText;

let timer: ReturnType<typeof setTimeout> | undefined;

/** Applies the query box to the active tab. */
export function applyQuery(): void {
  clearTimeout(timer);
  const t = state.active;
  if (t.query !== text()) t.setQuery(text());
}

/** Applies the query after `delay` ms, coalescing fast typing. */
export function scheduleApply(delay: number): void {
  clearTimeout(timer);
  timer = setTimeout(applyQuery, delay);
}

export function setQuery(q: string): void {
  setText(q);
  applyQuery();
}

/** Appends a term such as `-tag:Foo` to the current query. */
export function addQueryTerm(term: string): void {
  const q = text().trim();
  setQuery(q ? `${q} ${term}` : term);
}

export function toggleCase(): void {
  const t = state.active;
  t.setQuery(text(), !t.caseSens);
}

export function commitHistory(): void {
  const q = text().trim();
  if (!q) return;
  settings.history = [q, ...settings.history.filter(h => h !== q)].slice(0, 20);
  saveSettings();
}

export const isFavorite = (q: string) => !!q.trim() && settings.favorites.includes(q.trim());

export function toggleFavorite(): void {
  const q = text().trim();
  if (!q) return;
  settings.favorites = settings.favorites.includes(q)
    ? settings.favorites.filter(f => f !== q)
    : [q, ...settings.favorites];
  saveSettings();
}

export function removeFavorite(q: string): void {
  settings.favorites = settings.favorites.filter(f => f !== q);
  saveSettings();
}

export function clearHistory(): void {
  settings.history = [];
  saveSettings();
}
