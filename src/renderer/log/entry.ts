// Log entries as held by a tab, and how they are formatted for copying and export.

import { COLW } from '../constants';

export interface LogEntry {
  /** Increasing per tab; entries and views are sorted by it. */
  id: number;
  date: string;
  time: string;
  pid: string;
  tid: string;
  lvl: string;
  tag: string;
  msg: string;
  /** Process name, resolved from the pid when known. */
  proc?: string;
  /** Cached epoch ms of date + time, for `age:` filters. */
  ts?: number;
  /** A synthetic line (PROCESS STARTED/ENDED) or an unparsed raw line. */
  marker?: boolean;
  /** An unparsed line such as "--------- beginning of main". */
  raw?: boolean;
}

/** What is known about a device's processes. Names are kept after a process dies so old lines keep them. */
export interface ProcessTable {
  names: Map<string, string>;   // pid → process name
  running: Set<string>;         // pids currently running
  apps: Set<string>;            // running pids that are app processes
  appNames: Set<string>;        // every app process name seen so far
  mine: Set<string>;            // installed third-party packages (package:mine)
  mineAt: number;               // when `mine` was last refreshed
}

export const newProcessTable = (): ProcessTable => ({
  names: new Map(), running: new Set(), apps: new Set(), appNames: new Set(), mine: new Set(), mineAt: 0,
});

export interface HasProcessTable {
  readonly ds: ProcessTable;
}

export function markerEntry(id: number, msg: string, extra: Partial<LogEntry> = {}): LogEntry {
  return { id, date: '', time: '', pid: '', tid: '', lvl: '', tag: '', msg, marker: true, ...extra };
}

/** The entry's process name, resolving it from the pid the first time it becomes known. */
export function procOf(t: HasProcessTable, e: LogEntry): string {
  if (e.proc === undefined && e.pid) {
    const name = t.ds.names.get(e.pid);
    if (name) e.proc = name;
  }
  return e.proc || '';
}

export function entryTime(e: LogEntry): number {
  if (e.ts === undefined) e.ts = new Date(`${e.date}T${e.time}`).getTime();
  return e.ts;
}

export function markerText(e: LogEntry): string {
  return e.raw ? e.msg : `---------------------------- ${e.msg} ----------------------------`;
}

/** The line as shown in the view; used for copying and `line:` filters. */
export function displayLine(t: HasProcessTable, e: LogEntry): string {
  if (e.marker) return markerText(e);
  return `${e.date} ${e.time} ${`${e.pid}-${e.tid}`.padEnd(COLW.pid)}${e.tag.padEnd(COLW.tag - 1)} ` +
    `${procOf(t, e).padEnd(COLW.pkg - 1)} ${e.lvl}  ${e.msg}`;
}

/** threadtime with a year prefix, which Import (and other logcat tools) can read back. */
export function exportLine(e: LogEntry): string {
  if (e.marker) return markerText(e);
  return `${e.date} ${e.time} ${e.pid.padStart(5)} ${e.tid.padStart(5)} ${e.lvl} ${e.tag}: ${e.msg}`;
}
