// The filter query box: live filtering, case toggle, favorites, history and the syntax help.

import { els } from '../dom';
import { saveSettings, settings } from '../settings';
import { state } from '../state';
import { renderEmpty } from '../view/status';
import { type MenuItem, menuBelow, showMenu } from './menu';
import { hideSuggest, initSuggest, updateSuggest } from './suggest';

let queryTimer: ReturnType<typeof setTimeout> | undefined;

/** Applies the query box to the active tab. */
export function applyQuery(): void {
  clearTimeout(queryTimer);
  const t = state.active;
  t.query = els.query.value;
  t.refilter();
  renderQueryBox();
  renderEmpty();
  saveSettings();
}

/** Applies the query after `delay` ms, coalescing fast typing. */
export function scheduleApply(delay: number): void {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(applyQuery, delay);
}

export function setQuery(q: string): void {
  els.query.value = q;
  applyQuery();
}

/** Appends a term such as `-tag:Foo` to the current query. */
export function addQueryTerm(term: string): void {
  const q = els.query.value.trim();
  setQuery(q ? `${q} ${term}` : term);
}

export function commitHistory(): void {
  const q = els.query.value.trim();
  if (!q) return;
  settings.history = [q, ...settings.history.filter(h => h !== q)].slice(0, 20);
  saveSettings();
}

export function renderQueryBox(): void {
  const t = state.active;
  els.queryClear.hidden = !els.query.value;
  els.caseBtn.classList.toggle('on', t.caseSens);
  els.queryBox.classList.toggle('invalid', !!t.filter.error);
  els.queryBox.title = t.filter.error;
  const fav = !!t.query.trim() && settings.favorites.includes(t.query.trim());
  els.favBtn.classList.toggle('on', fav);
  els.favBtn.title = fav ? 'Remove filter from favorites' : 'Add filter to favorites';
}

function openFilterMenu(): void {
  const items: MenuItem[] = [];
  if (settings.favorites.length) {
    items.push({ header: 'Favorites' });
    for (const f of settings.favorites) {
      items.push({
        label: f,
        action: () => setQuery(f),
        remove: () => { settings.favorites = settings.favorites.filter(x => x !== f); renderQueryBox(); saveSettings(); },
      });
    }
  }
  const history = settings.history.filter(h => !settings.favorites.includes(h));
  if (history.length) {
    if (items.length) items.push('-');
    items.push({ header: 'History' });
    for (const h of history) items.push({ label: h, action: () => setQuery(h) });
    items.push('-', { label: 'Clear History', action: () => { settings.history = []; saveSettings(); } });
  }
  if (!items.length) items.push({ label: 'No saved or recent filters', disabled: true });
  menuBelow(els.filterMenu, items);
}

function toggleFavorite(): void {
  const q = els.query.value.trim();
  if (!q) return;
  settings.favorites = settings.favorites.includes(q)
    ? settings.favorites.filter(f => f !== q)
    : [q, ...settings.favorites];
  renderQueryBox();
  saveSettings();
}

function showHelp(): void {
  const node = els.helpTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const r = els.helpBtn.getBoundingClientRect();
  showMenu(r.right - 620, r.bottom + 4, [{ node }], 'help-menu');
}

export function initQueryBar(): void {
  els.query.addEventListener('input', () => {
    els.queryClear.hidden = !els.query.value;
    scheduleApply(150);
    updateSuggest();
  });
  els.query.addEventListener('blur', () => { commitHistory(); setTimeout(hideSuggest, 150); });
  els.queryClear.addEventListener('click', () => {
    els.query.value = '';
    applyQuery();
    els.query.focus();
  });
  els.caseBtn.addEventListener('click', () => {
    const t = state.active;
    t.caseSens = !t.caseSens;
    t.refilter();
    renderQueryBox();
    saveSettings();
  });
  els.favBtn.addEventListener('click', toggleFavorite);
  els.filterMenu.addEventListener('click', openFilterMenu);
  els.helpBtn.addEventListener('click', showHelp);
  initSuggest();
}
