// A logcat tab: one device (or imported file), its received lines, filters and view state.
//
// What the UI shows is held in Solid signals (name, device, filter, pause state, …). The lines are plain
// arrays, since a tab can hold 200k of them; `version` changes (at most once per frame) when they do,
// and `selection` when the selected lines change.

import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { LogLine, StreamOptions } from '../../shared/types';
import { MAX_ENTRIES, TAIL_LINES } from '../constants';
import { type LogEntry, markerEntry, newProcessTable, type ProcessTable, procOf } from '../log/entry';
import { type ProcSel, sameProc } from '../log/processes';
import { type CompiledFilter, compileQuery } from '../query/compile';
import { cleanMessage } from '../util/text';
import { firstIndexAtLeast } from '../util/search';
import { rowTop } from '../view/layout';
import { state } from './app';
import { devState, markProcsChanged, refreshProcs } from './devices';
import { saveSettings, settings, type TabSettings } from './settings';
import { closeStream, openStream } from './streams';

const START_RE = /^Start proc (\d+):([^\s/]+)/;
const DIED_RE = /^Process (\S+) \(pid (\d+)\) has died/;
const KILL_RE = /^Killing (\d+):([^\s/]+)/;

export interface TabOptions extends Partial<TabSettings> {
  /** Name of an imported log file; such tabs have no device. */
  file?: string;
}

export type ConnState = 'idle' | 'live' | 'reconnecting';

/** A signal used as a property: `get x() { return this.x$[0](); }`. */
type Sig<T> = [Accessor<T>, Setter<T>];
const sig = <T>(v: T, equals?: false): Sig<T> => createSignal(v, equals === false ? { equals: false } : undefined);

export class Tab {
  readonly file: string | null;
  private readonly fileDs = newProcessTable();

  private readonly name$: Sig<string>;
  private readonly device$: Sig<string>;
  private readonly query$: Sig<string>;
  private readonly caseSens$: Sig<boolean>;
  private readonly procSel$: Sig<ProcSel[]>;
  private readonly filter$: Sig<CompiledFilter>;
  private readonly pausedAtId$ = sig(Infinity);
  private readonly conn$ = sig<{ state: ConnState; msg: string }>({ state: 'idle', msg: '' });
  private readonly follow$ = sig(true);
  private readonly version$ = sig(0);
  private readonly selection$ = sig(0);
  private versionQueued = false;

  entries: LogEntry[] = [];
  /** Entries that pass the filters, in id order. */
  view: LogEntry[] = [];
  nextId = 1;
  /** Selected entry ids; call `selectionChanged()` after changing it. */
  selected = new Set<number>();
  anchorId: number | null = null;
  tagCounts = new Map<string, number>();
  /** Row tops when soft-wrapping (see view/layout.ts); null = needs recomputing. */
  tops: number[] | null = null;
  /** Scroll position while the tab isn't shown. */
  scrollTop = 0;

  streamId = 0;
  retryDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private endedPids = new Set<string>();
  /** Timestamp of the newest line, to resume from after a reconnect. */
  private lastStamp = '';
  /** Lines seen at lastStamp, to drop duplicates when resuming. */
  private lastKeys = new Set<string>();
  private resumeStamp = '';

  /** Called when old lines are trimmed from the top of the view, with the height (px) they took. */
  static onTrimmed: (tab: Tab, px: number) => void = () => {};

  constructor(opts: TabOptions) {
    this.name$ = sig(opts.name || 'Logcat');
    this.device$ = sig(opts.device || '');
    this.query$ = sig(opts.query || '');
    this.caseSens$ = sig(!!opts.caseSens);
    this.procSel$ = sig(opts.procSel || (opts.proc ? [opts.proc] : []));
    this.file = opts.file || null;
    this.filter$ = sig(compileQuery(this.query, this.caseSens));
  }

  get name(): string { return this.name$[0](); }
  set name(v: string) { this.name$[1](v); }
  get device(): string { return this.device$[0](); }
  get query(): string { return this.query$[0](); }
  set query(v: string) { this.query$[1](v); }
  get caseSens(): boolean { return this.caseSens$[0](); }
  set caseSens(v: boolean) { this.caseSens$[1](v); }
  get procSel(): ProcSel[] { return this.procSel$[0](); }
  get filter(): CompiledFilter { return this.filter$[0](); }
  get conn(): { state: ConnState; msg: string } { return this.conn$[0](); }
  /** Keep the newest line in view as lines arrive. */
  get follow(): boolean { return this.follow$[0](); }
  set follow(v: boolean) { this.follow$[1](v); }
  /** While paused, only entries up to this id are shown. */
  get pausedAtId(): number { return this.pausedAtId$[0](); }
  get paused(): boolean { return this.pausedAtId !== Infinity; }

  /** Changes (at most once per frame) when entries or the view change. */
  get version(): number { return this.version$[0](); }
  /** Changes when the selection changes. */
  get selection(): number { return this.selection$[0](); }

  get ds(): ProcessTable {
    return this.file ? this.fileDs : devState(this.device);
  }

  /** Marks the lines as changed; the view updates on the next frame. */
  changed(): void {
    if (this.versionQueued) return;
    this.versionQueued = true;
    requestAnimationFrame(() => {
      this.versionQueued = false;
      this.version$[1](v => v + 1);
    });
  }

  selectionChanged(): void {
    this.selection$[1](v => v + 1);
  }

  /** Forgets all lines (Clear, device change, restart). */
  reset(): void {
    this.entries = [];
    this.view = [];
    this.pausedAtId$[1](this.paused ? this.nextId - 1 : Infinity);
    this.selected = new Set();
    this.anchorId = null;
    this.tagCounts = new Map();
    this.endedPids = new Set();
    this.tops = null;
    this.lastStamp = '';
    this.lastKeys = new Set();
    this.resumeStamp = '';
    this.selectionChanged();
    this.changed();
  }

  // ----- filtering -----

  matches(e: LogEntry): boolean {
    return e.id <= this.pausedAtId && this.procMatch(e) && this.filter.test(e, this);
  }

  // Matching by name (not pid) keeps following an app across restarts.
  // A line passes if it comes from any selected package/process.
  private procMatch(e: LogEntry): boolean {
    const sel = this.procSel;
    if (!sel.length) return true;
    if (e.raw) return false;
    const name = procOf(this, e);
    if (!name) return false;
    const pkg = name.split(':')[0];
    return sel.some(p => (p.kind === 'process' ? name === p.value
      : p.kind === 'mine' ? this.ds.mine.has(pkg) : pkg === p.value));
  }

  /** Recompiles the query and rebuilds the view. */
  refilter(): void {
    this.filter$[1](compileQuery(this.query, this.caseSens));
    this.view = this.entries.filter(e => this.matches(e));
    this.tops = null;
    const visible = new Set(this.view.map(e => e.id));
    let dropped = false;
    for (const id of this.selected) if (!visible.has(id)) { this.selected.delete(id); dropped = true; }
    if (dropped) this.selectionChanged();
    this.changed();
  }

  setQuery(query: string, caseSens = this.caseSens): void {
    this.query = query;
    this.caseSens = caseSens;
    this.refilter();
    saveSettings();
  }

  setProcSel(sel: ProcSel[]): void {
    this.procSel$[1](sel);
    this.refilter();
    saveSettings();
  }

  toggleProc(p: ProcSel): void {
    const has = this.procSel.some(x => sameProc(x, p));
    this.setProcSel(has ? this.procSel.filter(x => !sameProc(x, p)) : [...this.procSel, p]);
  }

  setPaused(paused: boolean): void {
    this.pausedAtId$[1](paused ? this.nextId - 1 : Infinity);
    this.refilter();
  }

  /** Newly resolved process names can change which lines pass. */
  onProcsChanged(): void {
    if (this.filter.usesProc || this.procSel.length) this.refilter();
    else this.changed();
  }

  // ----- streaming -----

  setDevice(serial: string): void {
    if (serial === this.device && this.streamId) return;
    this.disconnect();
    this.device$[1](serial);
    this.reset();
    this.retryDelay = 1000;
    this.connect();
    saveSettings();
    void refreshProcs();
  }

  connect(): void {
    this.disconnect();
    if (this.file || !this.device) return;
    const opts: StreamOptions = { serial: this.device, buffer: settings.buffer };
    if (this.lastStamp) {
      opts.since = this.lastStamp.slice(5); // logcat -T wants MM-DD hh:mm:ss.mmm
      this.resumeStamp = this.lastStamp;
    } else {
      opts.tail = TAIL_LINES;
    }
    this.streamId = openStream(this, opts);
    this.setConn('live');
  }

  disconnect(): void {
    clearTimeout(this.reconnectTimer);
    if (this.streamId) {
      closeStream(this.streamId);
      this.streamId = 0;
    }
  }

  restart(): void {
    this.disconnect();
    this.reset();
    this.retryDelay = 1000;
    this.connect();
  }

  /** The stream ended (device unplugged, adb restarted, …): retry with backoff. */
  dropped(msg: string): void {
    this.disconnect();
    this.setConn('reconnecting', msg);
    this.reconnectTimer = setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 8000);
  }

  private setConn(s: ConnState, msg = ''): void {
    this.conn$[1]({ state: s, msg });
  }

  dispose(): void {
    this.disconnect();
  }

  // ----- ingest -----

  onLines(batch: LogLine[]): void {
    this.retryDelay = 1000;
    this.ingest(batch);
  }

  private push(e: LogEntry): void {
    this.entries.push(e);
    if (this.matches(e)) this.view.push(e);
  }

  ingest(batch: LogLine[]): void {
    const ds = this.ds;
    for (const item of batch) {
      if (typeof item === 'string') {
        // Markers like "--------- beginning of main" repeat on every resume; keep only the first ones.
        if (item.trim() && !this.resumeStamp) this.push(markerEntry(this.nextId++, item, { raw: true }));
        continue;
      }
      const [date, time, pid, tid, lvl, tag, rawMsg] = item;
      const msg = cleanMessage(rawMsg);
      const stamp = date + ' ' + time;
      const key = pid + '/' + tid + '/' + lvl + '/' + tag + '/' + msg;
      if (this.resumeStamp) {
        // After reconnecting with -T <time>, logcat replays lines at/after that time; drop the ones we have.
        if (stamp < this.resumeStamp || (stamp === this.resumeStamp && this.lastKeys.has(key))) continue;
        if (stamp > this.resumeStamp) this.resumeStamp = '';
      }
      if (stamp !== this.lastStamp) { this.lastStamp = stamp; this.lastKeys = new Set(); }
      this.lastKeys.add(key);
      this.push({ id: this.nextId++, date, time, pid, tid, lvl, tag, msg, proc: ds.names.get(pid) });
      this.tagCounts.set(tag, (this.tagCounts.get(tag) || 0) + 1);
      if (tag === 'ActivityManager') this.processEvent(msg, ds);
    }
    this.trim();
    this.changed();
  }

  // Mirror Android Studio's "PROCESS STARTED / ENDED" lines from ActivityManager events.
  private processEvent(msg: string, ds: ProcessTable): void {
    let m = START_RE.exec(msg);
    if (m) {
      const [, pid, name] = m;
      ds.names.set(pid, name);
      ds.appNames.add(name); // ActivityManager only starts app processes
      this.endedPids.delete(pid);
      this.push(markerEntry(this.nextId++, `PROCESS STARTED (${pid}) for package ${name}`, { pid, proc: name }));
      markProcsChanged();
      return;
    }
    let pid: string, name: string;
    if ((m = DIED_RE.exec(msg))) [, name, pid] = m;
    else if ((m = KILL_RE.exec(msg))) [, pid, name] = m;
    else return;
    if (this.endedPids.has(pid)) return;
    this.endedPids.add(pid);
    this.push(markerEntry(this.nextId++, `PROCESS ENDED (${pid}) for package ${name}`, { pid, proc: name }));
  }

  /** Drops the oldest lines beyond MAX_ENTRIES, keeping the view where it was if not following. */
  private trim(): void {
    if (this.entries.length <= MAX_ENTRIES * 1.1) return;
    const drop = this.entries.length - MAX_ENTRIES;
    const minId = this.entries[drop].id;
    this.entries = this.entries.slice(drop);
    const removed = firstIndexAtLeast(this.view, minId);
    if (removed) {
      const removedPx = rowTop(this, removed);
      this.view = this.view.slice(removed);
      this.tops = null;
      Tab.onTrimmed(this, removedPx);
    }
    for (const id of this.selected) if (id < minId) this.selected.delete(id);
  }

  /** Whether this is the tab shown in the window. */
  get isActive(): boolean {
    return state.isActive(this);
  }
}
