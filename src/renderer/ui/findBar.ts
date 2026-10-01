// The find bar above the log (Ctrl+F): type to highlight matches in messages, Enter / Shift+Enter
// (or F3 / Shift+F3) to step through them. It wraps around at either end.

import { ROW_H } from '../constants';
import { el, els } from '../dom';
import { state } from '../state';
import type { Tab } from '../tabs/Tab';
import { firstIndexAtLeast } from '../util/search';
import { find, firstIdAtLeast, matchIds, setFind, setFindOpen } from '../view/find';
import { indexAtY, rowTop } from '../view/layout';
import { queueRender, setOnRendered } from '../view/render';

const bar = el('findBar');
const box = el('findBox');
const input = el<HTMLInputElement>('findInput');
const count = el('findCount');
const caseBtn = el<HTMLButtonElement>('findCase');
const regexBtn = el<HTMLButtonElement>('findRegex');

export const isFindOpen = () => find.open;

export function openFind(): void {
  // Start from the selected text, like an editor's find.
  const picked = String(window.getSelection() ?? '').trim();
  if (picked && !picked.includes('\n')) input.value = picked;
  if (!find.open) {
    bar.hidden = false;
    setFindOpen(true);
    update(true);
  } else if (picked) {
    update(true);
  }
  input.focus();
  input.select();
}

export function closeFind(): void {
  if (!find.open) return;
  bar.hidden = true;
  setFindOpen(false);
  queueRender();
  els.log.focus();
}

/** Moves to the next (1) or previous (-1) match. */
export function findStep(dir: 1 | -1): void {
  if (!find.open) { openFind(); return; }
  const t = state.active;
  const ids = matchIds(t);
  if (!ids.length) return;
  let k: number;
  if (find.currentId !== null) {
    const i = firstIdAtLeast(ids, find.currentId);
    k = ids[i] === find.currentId ? i + dir : dir > 0 ? i : i - 1;
  } else {
    const i = firstIdAtLeast(ids, topVisibleId(t));
    k = dir > 0 ? i : i - 1;
  }
  show(t, ids[(k + ids.length) % ids.length]);
}

function topVisibleId(t: Tab): number {
  return t.view[indexAtY(t, els.log.scrollTop)]?.id ?? Infinity;
}

/** Makes `id` the current match and scrolls it into view if it isn't. */
function show(t: Tab, id: number): void {
  find.currentId = id;
  const top = rowTop(t, firstIndexAtLeast(t.view, id));
  const h = els.log.clientHeight;
  if (top < els.log.scrollTop || top + ROW_H > els.log.scrollTop + h) {
    t.follow = false;
    els.log.scrollTop = top - h / 3;
  }
  queueRender();
}

/** Applies the query; `jump` moves to the first match from the top of the view (as you type). */
function update(jump: boolean): void {
  setFind({ text: input.value, caseSens: caseBtn.classList.contains('on'), regex: regexBtn.classList.contains('on') });
  if (jump) {
    const t = state.active;
    const ids = matchIds(t);
    if (ids.length) {
      const i = firstIdAtLeast(ids, topVisibleId(t));
      show(t, ids[Math.min(i, ids.length - 1)]);
      return;
    }
  }
  queueRender();
}

function renderCount(): void {
  if (!find.open || !state.hasActive) return;
  const ids = matchIds(state.active);
  let text = '';
  if (find.invalid) text = 'Invalid regex';
  else if (find.text && !ids.length) text = 'No results';
  else if (find.text) {
    const i = find.currentId === null ? -1 : firstIdAtLeast(ids, find.currentId);
    text = ids[i] === find.currentId ? `${i + 1} of ${ids.length}` : `${ids.length} results`;
  }
  count.textContent = text;
  box.classList.toggle('none', !!find.text && !ids.length);
  box.classList.toggle('invalid', find.invalid);
}

export function initFindBar(): void {
  setOnRendered(renderCount);
  input.addEventListener('input', () => update(true));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      findStep(ev.shiftKey ? -1 : 1);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeFind();
    }
  });
  for (const btn of [caseBtn, regexBtn]) {
    btn.addEventListener('click', () => {
      btn.classList.toggle('on');
      update(true);
      input.focus();
    });
  }
  el('findPrev').addEventListener('click', () => findStep(-1));
  el('findNext').addEventListener('click', () => findStep(1));
  el('findClose').addEventListener('click', closeFind);
}
