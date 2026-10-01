// The package/process dropdown (multi-select) next to the device picker.

import { createEffect, createMemo, createSignal, For, on, onMount, Show } from 'solid-js';
import { PKG_RE } from '../../constants';
import { type ProcSel, procName, procStatus, sameProc } from '../../log/processes';
import { state } from '../../state/app';
import { procsChanged } from '../../state/devices';
import { closeMenu, toggleMenuBelow } from '../../state/menu';
import type { Tab } from '../../state/Tab';
import { Icon } from '../Icon';

interface Choice extends ProcSel {
  label?: string;
  hint?: string;
  dead?: boolean;
  /** The "All processes" row. */
  all?: boolean;
}

/** Rows for the dropdown: running apps, apps seen earlier, then system processes. */
export function procChoices(t: Tab): { running: Choice[]; stopped: Choice[]; system: Choice[] } {
  const ds = t.ds;
  const running = new Map<string, string[]>();   // package → pids
  const system = new Map<string, string[]>();    // process name → pids
  // Prefer the app-user info from ps; fall back to "looks like a package name" if it's unavailable.
  const isApp = (pid: string, pkg: string) => (ds.apps.size ? ds.apps.has(pid) : PKG_RE.test(pkg));
  const add = (m: Map<string, string[]>, k: string, pid: string) => { (m.get(k) ?? m.set(k, []).get(k)!).push(pid); };
  for (const pid of ds.running) {
    const name = ds.names.get(pid);
    if (!name) continue;
    const pkg = name.split(':')[0];
    if (isApp(pid, pkg)) add(running, pkg, pid);
    else add(system, name, pid);
  }
  const seen = new Set<string>();
  for (const name of ds.appNames) {
    const pkg = name.split(':')[0];
    if (!running.has(pkg)) seen.add(pkg);
  }
  const sortKeys = (m: Map<string, string[]>) => [...m.keys()].sort((a, b) => a.localeCompare(b));
  const pidHint = (pids: string[]) => pids.sort((a, b) => Number(a) - Number(b)).join(', ');
  return {
    running: sortKeys(running).map(pkg => ({ kind: 'package', value: pkg, hint: pidHint(running.get(pkg)!) })),
    stopped: [...seen].sort().map(pkg => ({ kind: 'package', value: pkg, hint: 'not running', dead: true })),
    system: sortKeys(system).map(name => ({ kind: 'process', value: name, hint: pidHint(system.get(name)!) })),
  };
}

interface Row {
  /** null = "All processes". */
  proc: ProcSel | null;
  choice: Choice;
}

function ProcMenu() {
  const t = state.active;
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  /** The row just toggled: stays active even though it moves between sections. */
  let keep: ProcSel | null | undefined;
  let scrollToActive = true;

  const isSel = (p: ProcSel) => t.procSel.some(x => sameProc(x, p));

  const model = createMemo(() => {
    procsChanged();
    const choices = procChoices(t);
    const q = query().trim().toLowerCase();
    const has = (c: Choice) => !q || c.value.toLowerCase().includes(q);
    const notSel = (c: Choice) => !isSel(c);
    const mine: Choice = { kind: 'mine', value: 'mine', label: 'Installed apps', hint: 'package:mine' };
    const selected: Choice[] = t.procSel.map(p => {
      const status = procStatus(t, p);
      return { ...p, label: procName(p), hint: status, dead: status === 'not running' };
    });
    const allRow: Choice = { kind: 'package', value: '', label: 'All processes', all: true };
    const sections: [string | null, Choice[]][] = [
      [null, [allRow, ...(isSel(mine) ? [] : [mine])].filter(r => !q || r.label!.toLowerCase().includes(q))],
      ['Selected', selected.filter(c => !q || c.label!.toLowerCase().includes(q))],
      ['Running apps', choices.running.filter(c => has(c) && notSel(c))],
      ['Not running', choices.stopped.filter(c => has(c) && notSel(c))],
      ['System processes', choices.system.filter(c => has(c) && notSel(c))],
    ];
    const rows: Row[] = [];
    const groups = sections.filter(([, items]) => items.length).map(([title, items]) => ({
      title,
      rows: items.map(c => {
        const row: Row = { proc: c.all ? null : { kind: c.kind, value: c.value }, choice: c };
        rows.push(row);
        return { row, index: rows.length - 1 };
      }),
    }));
    return { q, groups, rows };
  });

  // Pick the active row after the list changes.
  createEffect(on(model, m => {
    if (keep !== undefined) {
      const k = keep;
      setActive(Math.max(0, m.rows.findIndex(r => (r.proc === null ? k === null : k !== null && sameProc(r.proc, k)))));
      scrollToActive = false;
      keep = undefined;
    } else {
      setActive(m.q ? Math.max(0, m.rows.findIndex(r => r.proc !== null)) : 0); // first real match while searching
      scrollToActive = true;
    }
  }));
  createEffect(() => {
    const i = active();
    if (scrollToActive) list.querySelector(`.item[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  // Toggling keeps the menu open so several processes can be picked in one go.
  function toggle(p: ProcSel | null): void {
    keep = p;
    if (p === null) t.setProcSel([]);
    else t.toggleProc(p);
  }

  function onKey(ev: KeyboardEvent): void {
    const rows = model().rows;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      scrollToActive = true;
      if (rows.length) setActive(i => (i + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const typed = query().trim();
      if (rows.length) toggle(rows[active()].proc);
      else if (typed) { setQuery(''); input.value = ''; toggle({ kind: 'package', value: typed }); } // app not seen yet
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
    }
  }

  onMount(() => input.focus());

  return (
    <>
      <div class="menu-search">
        <Icon name="search" />
        <input ref={input} placeholder="Search packages and processes" spellcheck={false}
          onInput={ev => setQuery(ev.currentTarget.value)} onKeyDown={onKey} />
      </div>
      {/* mousedown is prevented to keep focus in the search box */}
      <div class="proc-list" ref={list} onMouseDown={ev => ev.preventDefault()}>
        <Show when={model().rows.length} fallback={
          <div class="item disabled">
            <span class="label">No matches{model().q ? ` — press Enter to add "${query().trim()}"` : ''}</span>
          </div>
        }>
          <For each={model().groups}>
            {g => (
              <>
                <Show when={g.title}><div class="menu-header">{g.title}</div></Show>
                <For each={g.rows}>
                  {({ row, index }) => {
                    const on = () => (row.proc ? isSel(row.proc) : !t.procSel.length);
                    return (
                      <div class="item" classList={{ dead: row.choice.dead, active: active() === index }} data-i={index}
                        onClick={() => toggle(row.proc)}>
                        <span class="cb" classList={{ on: on(), radio: row.choice.all }}><Show when={on()}><Icon name="check" /></Show></span>
                        <span class="label">{row.choice.label || row.choice.value}</span>
                        <Show when={row.choice.hint}><span class="hint">{row.choice.hint}</span></Show>
                      </div>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

export function ProcessSelector() {
  const label = createMemo(() => {
    procsChanged();
    const t = state.active;
    const sel = t.procSel;
    if (sel.length === 1) {
      const status = procStatus(t, sel[0]);
      return { main: procName(sel[0]), sub: status && status !== 'not running' && sel[0].kind !== 'mine' ? `(${status})` : status };
    }
    if (sel.length > 1) return { main: `${sel.length} processes`, sub: sel.map(procName).join(', ') };
    return { main: 'All processes', sub: '' };
  });
  const title = () => {
    const t = state.active;
    return t.procSel.length
      ? 'Showing logs from:\n' + t.procSel.map(p => `  ${procName(p)}  ${procStatus(t, p)}`).join('\n')
      : 'Show logs from selected packages or processes';
  };
  return (
    <button
      class="device-btn proc-btn"
      classList={{ set: state.active.procSel.length > 0 }}
      title={title()}
      onClick={ev => {
        if ((ev.target as Element).closest('.proc-clear')) { closeMenu(); state.active.setProcSel([]); return; }
        toggleMenuBelow(ev.currentTarget, () => [{ content: () => <ProcMenu /> }], 'proc-menu');
      }}
    >
      <Icon name="app" class="device-icon" />
      <span class="device-label">{label().main}</span>
      <span class="device-sub">{label().sub}</span>
      <Show when={state.active.procSel.length}>
        <span class="proc-clear" title="Show all processes"><Icon name="close" /></span>
      </Show>
      <Icon name="chevron" class="chevron" />
    </button>
  );
}
