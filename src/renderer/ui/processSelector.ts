// The package/process dropdown (multi-select) next to the device picker.

import { PKG_RE } from '../constants';
import { els } from '../dom';
import { type ProcSel, procName, procStatus, sameProc } from '../log/processes';
import { state } from '../state';
import type { Tab } from '../tabs/Tab';
import { esc } from '../util/text';
import { closeMenu, isMenuOpen, menuBelow } from './menu';

export function renderProc(): void {
  const t = state.active;
  const sel = t.procSel;
  let main = 'All processes', sub = '';
  if (sel.length === 1) {
    main = procName(sel[0]);
    const status = procStatus(t, sel[0]);
    sub = status && status !== 'not running' && sel[0].kind !== 'mine' ? `(${status})` : status;
  } else if (sel.length > 1) {
    main = `${sel.length} processes`;
    sub = sel.map(procName).join(', ');
  }
  els.procLabel.textContent = main;
  els.procSub.textContent = sub;
  els.procBtn.classList.toggle('set', sel.length > 0);
  els.procClear.hidden = !sel.length;
  els.procBtn.title = sel.length
    ? 'Showing logs from:\n' + sel.map(p => `  ${procName(p)}  ${procStatus(t, p)}`).join('\n')
    : 'Show logs from selected packages or processes';
}

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

function openProcMenu(): void {
  const t = state.active;
  const choices = procChoices(t);
  const box = document.createElement('div');
  box.innerHTML = '<div class="menu-search"><svg><use href="#i-search"/></svg>' +
    '<input placeholder="Search packages and processes" spellcheck="false"></div><div class="proc-list"></div>';
  const input = box.querySelector('input')!;
  const list = box.querySelector<HTMLElement>('.proc-list')!;
  let rows: (ProcSel | null)[] = [];   // null = "All processes"
  let activeIdx = 0;
  const isSel = (p: ProcSel) => t.procSel.some(x => sameProc(x, p));

  // Toggling keeps the menu open so several processes can be picked in one go.
  function toggle(p: ProcSel | null): void {
    if (p === null) t.setProcSel([]);
    else t.toggleProc(p);
    draw(p);
  }

  function draw(keep?: ProcSel | null): void {
    const q = input.value.trim().toLowerCase();
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
    rows = [];
    let html = '';
    for (const [title, items] of sections) {
      if (!items.length) continue;
      if (title) html += `<div class="menu-header">${title}</div>`;
      for (const it of items) {
        const proc: ProcSel | null = it.all ? null : { kind: it.kind, value: it.value };
        const on = proc ? isSel(proc) : !t.procSel.length;
        const i = rows.push(proc) - 1;
        html += `<div class="item${it.dead ? ' dead' : ''}" data-i="${i}">` +
          `<span class="cb${on ? ' on' : ''}${it.all ? ' radio' : ''}">${on ? '<svg><use href="#i-check"/></svg>' : ''}</span>` +
          `<span class="label">${esc(it.label || it.value)}</span>` +
          (it.hint ? `<span class="hint">${esc(it.hint)}</span>` : '') + '</div>';
      }
    }
    if (!rows.length) {
      html = `<div class="item disabled"><span class="label">No matches${q ? ' — press Enter to add "' + esc(input.value.trim()) + '"' : ''}</span></div>`;
    }
    const scroll = list.scrollTop;
    list.innerHTML = html;
    if (keep !== undefined) {
      // Stay on the row that was just toggled, even though it moved between sections.
      activeIdx = Math.max(0, rows.findIndex(r => (r === null ? keep === null : keep !== null && sameProc(r, keep))));
      list.scrollTop = scroll;
    } else {
      activeIdx = q ? Math.max(0, rows.findIndex(r => r !== null)) : 0; // first real match while searching
    }
    highlightRow(keep === undefined);
  }

  function highlightRow(scroll = true): void {
    list.querySelectorAll<HTMLElement>('.item[data-i]').forEach(e => e.classList.toggle('active', Number(e.dataset.i) === activeIdx));
    const row = list.querySelector(`.item[data-i="${activeIdx}"]`);
    if (row && scroll) row.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => draw());
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (rows.length) activeIdx = (activeIdx + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      highlightRow();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const typed = input.value.trim();
      if (rows.length) toggle(rows[activeIdx]);
      else if (typed) { input.value = ''; toggle({ kind: 'package', value: typed }); } // app not seen yet
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
    }
  });
  list.addEventListener('mousedown', ev => ev.preventDefault()); // keep focus in the search box
  list.addEventListener('click', ev => {
    const row = (ev.target as Element).closest<HTMLElement>('.item[data-i]');
    if (row) toggle(rows[Number(row.dataset.i)]);
  });

  menuBelow(els.procBtn, [{ node: box }], 'proc-menu');
  draw();
  input.focus();
}

export function initProcessSelector(): void {
  els.procBtn.addEventListener('click', ev => {
    if ((ev.target as Element).closest('#procClear')) { closeMenu(); state.active.setProcSel([]); return; }
    if (isMenuOpen(els.procBtn)) closeMenu();
    else openProcMenu();
  });
}
