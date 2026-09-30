// Package/process selections (the dropdown next to the device picker).

import type { HasProcessTable, ProcessTable } from './entry';

export type ProcKind = 'package' | 'process' | 'mine';

export interface ProcSel {
  kind: ProcKind;
  value: string;
}

export const sameProc = (a: ProcSel, b: ProcSel) => a.kind === b.kind && a.value === b.value;

export const procName = (p: ProcSel) => (p.kind === 'mine' ? 'Installed apps' : p.value);

export function runningPids(ds: ProcessTable, match: (name: string) => boolean): string[] {
  return [...ds.running].filter(pid => match(ds.names.get(pid) || '')).sort((a, b) => Number(a) - Number(b));
}

export function procPids(t: HasProcessTable, p: ProcSel): string[] {
  return runningPids(t.ds, name => (p.kind === 'process' ? name === p.value : name.split(':')[0] === p.value));
}

/** "1234, 5678", "not running", or a label for `package:mine`. */
export function procStatus(t: HasProcessTable & { file: string | null }, p: ProcSel): string {
  if (p.kind === 'mine') return 'package:mine';
  if (t.file) return '';
  const pids = procPids(t, p);
  return pids.length ? pids.join(', ') : 'not running';
}
