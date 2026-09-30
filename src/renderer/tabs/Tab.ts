// A logcat tab: one device (or imported file), its received lines, filters and view state.

import type { LogLine, StreamOptions } from '../../shared/types';
import { MAX_ENTRIES, TAIL_LINES } from '../constants';
import { devState, refreshProcs } from '../devices';
import { type LogEntry, markerEntry, newProcessTable, type ProcessTable, procOf } from '../log/entry';
import { type ProcSel, sameProc } from '../log/processes';
import { type CompiledFilter, compileQuery } from '../query/compile';
import { saveSettings, settings, type TabSettings } from '../settings';
import { state } from '../state';
import { renderDevice } from '../ui/deviceSelector';
import { renderProc } from '../ui/processSelector';
import { renderToolbar } from '../ui/toolbar';
import { els } from '../dom';
import { firstIndexAtLeast } from '../util/search';
import { cleanMessage } from '../util/text';
import { rowTop } from '../view/layout';
import { queueRender } from '../view/render';
import { renderEmpty, renderNotice } from '../view/status';
import { closeStream, openStream } from './streams';

const START_RE = /^Start proc (\d+):([^\s/]+)/;
const DIED_RE = /^Process (\S+) \(pid (\d+)\) has died/;
const KILL_RE = /^Killing (\d+):([^\s/]+)/;

export interface TabOptions extends Partial<TabSettings> {
  /** Name of an imported log file; such tabs have no device. */
  file?: string;
}

export type ConnState = 'idle' | 'live' | 'reconnecting';

export class Tab {
  name: string;
  device: string;
  query: string;
  caseSens: boolean;
  /** Package/process dropdown selection; empty = all processes. */
  procSel: ProcSel[];
  readonly file: string | null;
  private readonly fileDs = newProcessTable();

  filter!: CompiledFilter;
  entries: LogEntry[] = [];
  /** Entries that pass the filters, in id order. */
  view: LogEntry[] = [];
  nextId = 1;
  /** While paused, only entries up to this id are shown. */
  pausedAtId = Infinity;
  selected = new Set<number>();
  anchorId: number | null = null;
  tagCounts = new Map<string, number>();
  /** Row tops when soft-wrapping (see view/layout.ts); null = needs recomputing. */
  tops: number[] | null = null;
  follow = true;
  scrollTop = 0;

  streamId = 0;
  retryDelay = 1000;
  conn: { state: ConnState; msg: string } = { state: 'idle', msg: '' };
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private endedPids = new Set<string>();
  /** Timestamp of the newest line, to resume from after a reconnect. */
  private lastStamp = '';
  /** Lines seen at lastStamp, to drop duplicates when resuming. */
  private lastKeys = new Set<string>();
  private resumeStamp = '';

  constructor(opts: TabOptions) {
    this.name = opts.name || 'Logcat';
    this.device = opts.device || '';
    this.query = opts.query || '';
    this.caseSens = !!opts.caseSens;
    this.procSel = opts.procSel || (opts.proc ? [opts.proc] : []);
    this.file = opts.file || null;
    this.compile();
  }

  get ds(): ProcessTable {
    return this.file ? this.fileDs : devState(this.device);
  }

  get paused(): boolean {
    return this.pausedAtId !== Infinity;
  }

  private get isActive(): boolean {
    return state.isActive(this);
  }

  /** Forgets all lines (Clear, device change, restart). */
  reset(): void {
    this.entries = [];
    this.view = [];
    this.pausedAtId = this.paused ? this.nextId - 1 : Infinity;
    this.selected = new Set();
    this.anchorId = null;
    this.tagCounts = new Map();
    this.endedPids = new Set();
    this.tops = null;
    this.lastStamp = '';
    this.lastKeys = new Set();
    this.resumeStamp = '';
    if (this.isActive) queueRender();
  }

  // ----- filtering -----

  compile(): void {
    this.filter = compileQuery(this.query, this.caseSens);
  }

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

  refilter(): void {
    this.compile();
    this.view = this.entries.filter(e => this.matches(e));
    this.tops = null;
    const visible = new Set(this.view.map(e => e.id));
    for (const id of this.selected) if (!visible.has(id)) this.selected.delete(id);
    if (this.isActive) queueRender();
  }

  setProcSel(sel: ProcSel[]): void {
    this.procSel = sel;
    this.refilter();
    saveSettings();
    if (this.isActive) { renderProc(); renderEmpty(); }
  }

  toggleProc(p: ProcSel): void {
    const has = this.procSel.some(x => sameProc(x, p));
    this.setProcSel(has ? this.procSel.filter(x => !sameProc(x, p)) : [...this.procSel, p]);
  }

  setPaused(paused: boolean): void {
    this.pausedAtId = paused ? this.nextId - 1 : Infinity;
    this.refilter();
    if (this.isActive) { renderToolbar(); renderNotice(); }
  }

  /** Newly resolved process names can change which lines pass. */
  onProcsChanged(): void {
    if (this.filter.usesProc || this.procSel.length) this.refilter();
    else if (this.isActive) queueRender();
  }

  // ----- streaming -----

  setDevice(serial: string): void {
    if (serial === this.device && this.streamId) return;
    this.disconnect();
    this.device = serial;
    this.reset();
    this.retryDelay = 1000;
    this.connect();
    saveSettings();
    if (this.isActive) { renderDevice(); renderProc(); renderNotice(); }
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
    this.conn = { state: s, msg };
    if (this.isActive) renderNotice();
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
    if (this.isActive) queueRender();
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
      if (this.isActive && !this.follow) els.log.scrollTop = Math.max(0, els.log.scrollTop - removedPx);
    }
    for (const id of this.selected) if (id < minId) this.selected.delete(id);
  }
}
