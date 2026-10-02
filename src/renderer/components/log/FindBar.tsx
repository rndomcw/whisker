// The find bar above the log (Ctrl+F): type to highlight matches in messages, Enter / Shift+Enter
// (or F3 / Shift+F3) to step through them. It wraps around at either end.

import { createMemo, createSignal, Show } from 'solid-js';
import { state } from '../../state/app';
import { find, firstIdAtLeast, matchIds, setFind, setFindOpen } from '../../state/find';
import type { Tab } from '../../state/Tab';
import { firstIndexAtLeast } from '../../util/search';
import { Icon } from '../Icon';
import { cx, IconButton, queryField, queryInput, TextToggle } from '../ui';
import { focusLog, reveal, topIndex } from './actions';

let input: HTMLInputElement | undefined;
const [text, setText] = createSignal('');
const [caseSens, setCaseSens] = createSignal(false);
const [regex, setRegex] = createSignal(false);

export const isFindOpen = () => find.open;

export function openFind(): void {
  // Start from the selected text, like an editor's find.
  const picked = String(window.getSelection() ?? '').trim();
  if (picked && !picked.includes('\n')) setText(picked);
  if (!find.open) {
    setFindOpen(true);
    update(true);
  } else if (picked) {
    update(true);
  }
  queueMicrotask(() => { input?.focus(); input?.select(); });
}

export function closeFind(): void {
  if (!find.open) return;
  setFindOpen(false);
  focusLog();
}

function topVisibleId(t: Tab): number {
  return t.view[topIndex(t)]?.id ?? Infinity;
}

/** Makes `id` the current match and scrolls it into view if it isn't. */
function show(t: Tab, id: number): void {
  find.currentId = id;
  reveal(t, firstIndexAtLeast(t.view, id));
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

/** Applies the query; `jump` moves to the first match from the top of the view (as you type). */
function update(jump: boolean): void {
  setFind({ text: text(), caseSens: caseSens(), regex: regex() });
  if (!jump) return;
  const t = state.active;
  const ids = matchIds(t);
  if (ids.length) show(t, ids[Math.min(firstIdAtLeast(ids, topVisibleId(t)), ids.length - 1)]);
}

export function FindBar() {
  // The count follows streaming lines and tab switches.
  const result = createMemo(() => {
    if (!find.open) return { text: '', none: false };
    const t = state.active;
    t.version;
    find.re;
    const ids = matchIds(t);
    if (find.invalid) return { text: 'Invalid regex', none: true };
    if (!find.text) return { text: '', none: false };
    if (!ids.length) return { text: 'No results', none: true };
    const i = find.currentId === null ? -1 : firstIdAtLeast(ids, find.currentId);
    return { text: ids[i] === find.currentId ? `${i + 1} of ${ids.length}` : `${ids.length} results`, none: false };
  });

  const toggle = (set: (fn: (v: boolean) => boolean) => void) => {
    set(v => !v);
    update(true);
    input?.focus();
  };

  return (
    <Show when={find.open}>
      <div class="flex flex-none items-center gap-0.5 border-b border-line bg-panel px-2 py-1">
        <div class={cx(queryField(find.invalid, true), 'mr-1 w-[min(460px,100%)] flex-none pl-1.5')}>
          <Icon name="search" class="flex-none text-icon" />
          <input
            id="findInput"
            class={queryInput}
            ref={input}
            spellcheck={false}
            autocomplete="off"
            placeholder="Find in messages"
            value={text()}
            onInput={ev => { setText(ev.currentTarget.value); update(true); }}
            onKeyDown={ev => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                findStep(ev.shiftKey ? -1 : 1);
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeFind();
              }
            }}
          />
          <span class={cx('whitespace-nowrap px-1.5 text-[12px]', result().none ? 'text-error' : 'text-dim')}>{result().text}</span>
          <TextToggle on={caseSens()} title="Match case" onClick={() => toggle(setCaseSens)}>Cc</TextToggle>
          <TextToggle on={regex()} title="Regular expression" onClick={() => toggle(setRegex)}>.*</TextToggle>
        </div>
        <IconButton small icon="up" title="Previous match (Shift+Enter)" onClick={() => findStep(-1)} />
        <IconButton small icon="down" title="Next match (Enter)" onClick={() => findStep(1)} />
        <IconButton small icon="close" title="Close (Esc)" onClick={closeFind} />
      </div>
    </Show>
  );
}
