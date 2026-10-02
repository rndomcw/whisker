// The virtualized log: only the rows on screen exist in the DOM. Rows are keyed by entry, so while
// lines stream in only the new rows are created; selection, hover and the current find match are
// class bindings that update without re-rendering rows.

import { createComputed, createEffect, createMemo, createSelector, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { COLW, ROW_H, TAG_COLORS } from '../../constants';
import { type LogEntry, markerText, procOf } from '../../log/entry';
import { state } from '../../state/app';
import { procsChanged } from '../../state/devices';
import { find } from '../../state/find';
import { settings } from '../../state/settings';
import { Tab } from '../../state/Tab';
import { firstIndexAtLeast } from '../../util/search';
import { esc } from '../../util/text';
import { ensureLayout, indexAtY, measure, metrics, rowLines, rowTop, setLayoutElements } from '../../view/layout';
import { Icon } from '../Icon';
import { scrollToEnd, setLogElement } from './actions';
import { showRowMenu } from './rowMenu';

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

/** The message with matches marked: the find bar's while it is open, otherwise the filter's. */
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

export function LogView() {
  let logEl!: HTMLElement;
  let probeEl!: HTMLSpanElement;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  /** Pointer position relative to the top of the view; null when outside. */
  const [pointerY, setPointerY] = createSignal<number | null>(null);

  const tab = () => state.active;

  // Row geometry for the current lines. Reading `version` makes this update as lines arrive.
  const frame = createMemo(() => {
    const t = tab();
    t.version;
    size();
    settings.wrap;
    measure(); // reads the format settings, so column changes re-measure too
    ensureLayout(t);
    const n = t.view.length;
    return { t, n, total: rowTop(t, n), cpl: metrics.cpl };
  }, undefined, { equals: false });

  // While following, the view is pinned to the bottom (the DOM scroll catches up after rendering).
  const top = () => {
    const f = frame();
    return f.t.follow ? Math.max(0, f.total - size().h) : scrollTop();
  };

  const visible = createMemo(() => {
    const { t, n } = frame();
    const y = top();
    const bottom = y + size().h + 4 * ROW_H;
    const start = Math.max(0, Math.min(n, indexAtY(t, y)) - 4);
    let end = start;
    while (end < n && rowTop(t, end) < bottom) end++;
    return { offset: rowTop(t, start), rows: t.view.slice(start, end) };
  });

  const hoverId = createMemo(() => {
    const py = pointerY();
    if (py === null) return null;
    const { t, n, total } = frame();
    const y = py + top();
    const i = indexAtY(t, y);
    return y >= 0 && i >= 0 && i < n && y < total ? t.view[i].id : null;
  });
  const isHover = createSelector(hoverId);
  const isFindCurrent = createSelector(() => find.currentId);
  const isSelected = (id: number) => (tab().selection, tab().selected.has(id));

  // Switching tabs restores that tab's scroll position.
  createComputed(on(tab, t => setScrollTop(t.scrollTop)));
  createEffect(() => {
    const { t, total } = frame();
    void total;
    if (t.follow) logEl.scrollTop = logEl.scrollHeight;
    else if (Math.abs(logEl.scrollTop - scrollTop()) > 1) logEl.scrollTop = scrollTop();
  });

  function onScroll(): void {
    const t = tab();
    const y = logEl.scrollTop;
    setScrollTop(y);
    t.scrollTop = y;
    t.follow = y + logEl.clientHeight >= logEl.scrollHeight - ROW_H;
  }

  function entryAt(target: EventTarget | null): LogEntry | null {
    const row = (target as Element | null)?.closest<HTMLElement>('.row');
    if (!row) return null;
    const t = tab();
    const id = Number(row.dataset.id);
    const e = t.view[firstIndexAtLeast(t.view, id)];
    return e && e.id === id ? e : null;
  }

  function onMouseDown(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    const e = entryAt(ev.target);
    if (!e) return;
    const t = tab();
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
    t.selectionChanged();
    t.follow = false; // keep the clicked line in place
    logEl.focus();
  }

  function onContextMenu(ev: MouseEvent): void {
    ev.preventDefault();
    const e = entryAt(ev.target);
    if (e) showRowMenu(ev.clientX, ev.clientY, tab(), e);
  }

  onMount(() => {
    setLogElement(logEl);
    setLayoutElements(logEl, probeEl);
    const ro = new ResizeObserver(() => setSize({ w: logEl.clientWidth, h: logEl.clientHeight }));
    ro.observe(logEl);
    onCleanup(() => ro.disconnect());
    // Trimming old lines shifts the rest up; keep the visible lines in place.
    Tab.onTrimmed = (t, px) => {
      if (state.isActive(t) && !t.follow) logEl.scrollTop = Math.max(0, logEl.scrollTop - px);
    };
  });

  const Row = (props: { e: LogEntry }) => {
    const e = props.e;
    const t = tab();
    const cls = () => ({ sel: isSelected(e.id), hover: isHover(e.id), 'find-cur': isFindCurrent(e.id) });
    if (e.marker) {
      return <div class={`row marker${e.raw ? '' : ' proc'}`} classList={cls()} data-id={e.id}>{markerText(e)}</div>;
    }
    const height = () => {
      frame(); // re-evaluate when the wrap width changes
      const lines = rowLines(e);
      return lines > 1 ? `${lines * ROW_H}px` : undefined;
    };
    // Process names can be resolved after the line arrived.
    const proc = () => (procsChanged(), t.version, procOf(t, e));
    return (
      <div class={`row L${e.lvl}`} classList={cls()} data-id={e.id} style={{ height: height() }}>
        <span class="c-time">{settings.format.date ? e.date + ' ' + e.time : e.time}</span>
        <span class="c-pid">{e.pid}-{e.tid}</span>
        <span class={`c-tag ${tagClass(e.tag)}`} title={e.tag}>{e.tag}</span>
        <span class="c-pkg" title={proc()}>{proc()}</span>
        <span class="c-lvl"><b>{e.lvl}</b></span>
        <span class="c-msg" innerHTML={highlight(t, e.msg)} />
      </div>
    );
  };

  return (
    <>
      <main
        id="log"
        ref={logEl}
        tabindex="0"
        classList={{
          'hide-pid': !settings.format.pid,
          'hide-tag': !settings.format.tag,
          'hide-pkg': !settings.format.pkg,
          wrap: settings.wrap,
        }}
        style={{
          '--w-time': (settings.format.date ? COLW.date : COLW.time) + 'ch',
          '--w-pid': COLW.pid + 'ch',
          '--w-tag': COLW.tag + 'ch',
          '--w-pkg': COLW.pkg + 'ch',
          '--w-lvl': COLW.lvl + 'ch',
        }}
        onScroll={onScroll}
        onMouseMove={ev => setPointerY(ev.clientY - logEl.getBoundingClientRect().top)}
        onMouseLeave={() => setPointerY(null)}
      >
        <span id="probe" ref={probeEl} aria-hidden="true">{'0'.repeat(100)}</span>
        <div id="spacer" style={{ height: frame().total + 'px' }} />
        <div
          id="rows"
          style={{ transform: `translateY(${visible().offset}px)` }}
          onMouseDown={onMouseDown}
          onContextMenu={onContextMenu}
        >
          <For each={visible().rows}>{e => <Row e={e} />}</For>
        </div>
      </main>
      <Show when={!tab().follow && frame().n > 0}>
        <button
          class="absolute right-[22px] bottom-[18px] flex size-8 items-center justify-center rounded-full bg-accent text-white shadow-[0_2px_10px_rgba(0,0,0,.35)]"
          title="Scroll to End (End)"
          onClick={scrollToEnd}
        >
          <Icon name="end" />
        </button>
      </Show>
    </>
  );
}
