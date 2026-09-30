'use strict';

const api = window.logcat;
const $ = id => document.getElementById(id);
const els = {
  tabs: $('tabs'), addTab: $('addTab'),
  deviceBtn: $('deviceBtn'), deviceIcon: $('deviceIcon'), deviceLabel: $('deviceLabel'), deviceSub: $('deviceSub'),
  procBtn: $('procBtn'), procLabel: $('procLabel'), procSub: $('procSub'), procClear: $('procClear'),
  queryBox: $('queryBox'), query: $('query'), filterMenu: $('filterMenu'), queryClear: $('queryClear'),
  caseBtn: $('caseBtn'), favBtn: $('favBtn'), helpBtn: $('helpBtn'),
  clear: $('btnClear'), pause: $('btnPause'), pauseIcon: $('pauseIcon'), restart: $('btnRestart'), end: $('btnEnd'),
  prev: $('btnPrev'), next: $('btnNext'), wrap: $('btnWrap'), importBtn: $('btnImport'), exportBtn: $('btnExport'),
  format: $('btnFormat'), shot: $('btnShot'), mirror: $('btnMirror'),
  log: $('log'), probe: $('probe'), spacer: $('spacer'), rows: $('rows'), notice: $('notice'), empty: $('empty'),
  follow: $('follow'), suggest: $('suggest'), toast: $('toast'), helpTpl: $('helpTpl'),
};

const ROW_H = 20;                 // keep in sync with --row-h
const MAX_ENTRIES = 200000;       // per tab, before the oldest lines are dropped
const LEVEL_RANK = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5, A: 5 };
const LEVEL_WORDS = {
  V: 'V', VERBOSE: 'V', D: 'D', DEBUG: 'D', I: 'I', INFO: 'I', W: 'W', WARN: 'W', WARNING: 'W',
  E: 'E', ERROR: 'E', A: 'A', ASSERT: 'A', F: 'A', FATAL: 'A',
};
const COLW = { date: 24, time: 13, pid: 13, tag: 24, pkg: 32, lvl: 3 }; // column widths in ch
const TAG_COLORS = 12;            // .t0 … .t11 in style.css
const BUFFERS = ['default', 'all', 'main', 'system', 'crash', 'events', 'radio'];
const SETTINGS_KEY = 'logcat-settings-v2';

document.body.classList.add(api.platform === 'win32' ? 'win' : api.platform);

// ---------- settings ----------

const settings = loadSettings();

function loadSettings() {
  const defaults = {
    tabs: [{ name: 'Logcat', device: '', query: '', caseSens: false }],
    active: 0,
    wrap: false,
    buffer: 'default',
    format: { date: true, pid: true, tag: true, pkg: true },
    favorites: [],
    history: [],
    mirror: false,
    mirrorWidth: 380,
  };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && Array.isArray(s.tabs) && s.tabs.length) {
      return { ...defaults, ...s, format: { ...defaults.format, ...s.format } };
    }
  } catch { /* storage unavailable */ }
  return defaults;
}

let saveTimer = null;
let resetting = false;
function saveSettings() {
  if (resetting) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const live = tabs.filter(t => !t.file);
    settings.tabs = live.map(t => ({ name: t.name, device: t.device, query: t.query, caseSens: t.caseSens, procSel: t.procSel }));
    settings.active = Math.max(0, live.indexOf(active));
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }, 200);
}

// ---------- helpers ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = s => String(s).replace(/[&<>"]/g, c => ESC[c]);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoteIfNeeded = v => (/[\s()|&"\\]/.test(v) || v === '' ? `"${v.replace(/[\\"]/g, '\\$&')}"` : v);
const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

function firstIndexAtLeast(arr, id) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].id < id) lo = mid + 1; else hi = mid; }
  return lo;
}

const tagClassCache = new Map();
function tagClass(tag) {
  let c = tagClassCache.get(tag);
  if (c === undefined) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
    c = 't' + (Math.abs(h) % TAG_COLORS);
    tagClassCache.set(tag, c);
  }
  return c;
}

let toastTimer = null;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
}

// ---------- devices ----------

const devices = { list: [], info: new Map(), state: new Map(), error: '', loaded: false };

// Per-device process table shared by all tabs on that device. Names are kept after a process dies
// so its old lines still show the package.
function devState(serial) {
  let d = devices.state.get(serial);
  if (!d) {
    // apps: pids of app processes (running); appNames: every app process name seen so far
    d = { names: new Map(), running: new Set(), apps: new Set(), appNames: new Set(), mine: new Set(), mineAt: 0 };
    devices.state.set(serial, d);
  }
  return d;
}

function deviceOnline(serial) {
  return devices.list.some(d => d.serial === serial && d.state === 'device');
}

function deviceText(serial) {
  const d = devices.list.find(x => x.serial === serial);
  const info = devices.info.get(serial);
  if (info && info.model) {
    return {
      main: `${capitalize(info.manufacturer)} ${info.model} (${serial})`,
      sub: d ? (d.state === 'device' ? `Android ${info.release}, API ${info.sdk}` : d.state) : 'Disconnected',
    };
  }
  const model = d && d.model ? d.model.replace(/_/g, '-') : '';
  return { main: model ? `${model} (${serial})` : serial, sub: d ? (d.state === 'device' ? '' : d.state) : 'Disconnected' };
}

async function refreshDevices() {
  let list;
  try {
    list = await api.devices();
    devices.error = '';
  } catch (e) {
    devices.error = e.message;
    list = [];
  }
  devices.list = list;
  for (const d of list) {
    if (d.state === 'device' && !devices.info.has(d.serial)) {
      devices.info.set(d.serial, null);
      api.deviceInfo(d.serial)
        .then(info => { devices.info.set(d.serial, info); renderDevice(); })
        .catch(() => devices.info.delete(d.serial));
    }
  }
  const ready = list.find(d => d.state === 'device');
  for (const t of tabs) {
    if (t.file) continue;
    // Pick a device for tabs without one, or whose remembered device isn't attached at startup.
    if (ready && (!t.device || (!devices.loaded && !list.some(d => d.serial === t.device)))) t.setDevice(ready.serial);
    // A device came back: reconnect now instead of waiting for the retry backoff.
    else if (t.device && t.conn.state === 'reconnecting' && deviceOnline(t.device) && t.retryDelay > 1000) t.connect();
  }
  if (!devices.error) devices.loaded = true;
  renderDevice();
  renderNotice();
}

async function refreshProcs() {
  const serials = new Set(tabs.filter(t => !t.file && t.device).map(t => t.device));
  for (const serial of serials) {
    if (!deviceOnline(serial)) continue;
    const ds = devState(serial);
    try {
      const { procs: map, apps } = await api.procs(serial);
      ds.running = new Set(Object.keys(map));
      ds.apps = new Set(apps);
      for (const pid of apps) ds.appNames.add(map[pid]);
      let changed = false;
      for (const [pid, name] of Object.entries(map)) {
        if (ds.names.get(pid) !== name) { ds.names.set(pid, name); changed = true; }
      }
      if (Date.now() - ds.mineAt > 30000) {
        ds.mineAt = Date.now();
        try { ds.mine = new Set(await api.packages(serial)); changed = true; } catch { /* keep old list */ }
      }
      if (changed) for (const t of tabs) if (t.device === serial) t.onProcsChanged();
    } catch { /* device busy or gone; try again next tick */ }
  }
  if (active) renderProc(); // pids change when the app restarts
}

// ---------- query language (Android Studio compatible) ----------

const KEYS = ['tag', 'package', 'process', 'message', 'line', 'level', 'age', 'is'];
const TEXT_KEYS = new Set(['tag', 'package', 'process', 'message', 'line']);
const IS_TESTS = {
  crash: e => e.lvl === 'A' || e.lvl === 'F' || (e.lvl === 'E' && e.tag === 'AndroidRuntime'),
  stacktrace: e => /^\s*(at\s|Caused by:|\.\.\.\s\d+\smore)/.test(e.msg),
};
const START_RE = /^Start proc (\d+):([^\s/]+)/;
const DIED_RE = /^Process (\S+) \(pid (\d+)\) has died/;
const KILL_RE = /^Killing (\d+):([^\s/]+)/;

function tokenize(q) {
  const toks = [];
  let i = 0;
  const isBreak = c => /\s/.test(c) || '()|&'.includes(c);
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('()|&'.includes(c)) { toks.push({ op: c }); i++; continue; }
    const start = i;
    let word = '';
    while (i < q.length && !isBreak(q[i])) {
      if (q[i] === '"') {
        i++;
        while (i < q.length && q[i] !== '"') {
          if (q[i] === '\\' && i + 1 < q.length) i++;
          word += q[i++];
        }
        i++;
      } else if (q[i] === '\\' && i + 1 < q.length) {
        word += q[i + 1];
        i += 2;
      } else {
        word += q[i++];
      }
    }
    const literal = q[start] === '"' || (q[start] === '-' && q[start + 1] === '"');
    toks.push({ word, literal });
  }
  return toks;
}

// Some SDKs color their logs with terminal escape codes ("\x1b[093m text \x1b[0m"); logcat shows them as junk.
const ANSI_RE = /\x1b?\[\d{1,3}(?:;\d{1,3})*m/g;

function cleanMessage(msg) {
  if (msg.includes('[')) msg = msg.replace(ANSI_RE, '');
  if (msg.includes('\t')) msg = msg.replace(/\t/g, '    ');
  return msg;
}

// A filter term for "lines like this one": the message up to its first number, so lines that only
// differ in counters or ids (e.g. "fps 9.88") are hidden together.
function messageTerm(msg) {
  let text = msg.trim();
  const num = text.search(/\d/);
  if (num > 8) text = text.slice(0, num);
  text = text.slice(0, 60).trim();
  return text;
}

function procOf(t, e) {
  if (e.proc === undefined && e.pid) {
    const name = t.ds.names.get(e.pid);
    if (name) e.proc = name;
  }
  return e.proc || '';
}

function entryTime(e) {
  if (e.ts === undefined) e.ts = new Date(`${e.date}T${e.time}`).getTime();
  return e.ts;
}

function compileQuery(query, cs) {
  const errors = [];
  const highlights = [];
  let usesProc = false;
  const fold = s => (cs ? s : s.toLowerCase());

  function textMatcher(op, v) {
    if (op === '~:') {
      try {
        const re = new RegExp(v, cs ? '' : 'i');
        return s => re.test(s);
      } catch (err) {
        errors.push(err.message);
        return null;
      }
    }
    const needle = fold(v);
    return op === '=:' ? s => fold(s) === needle : s => fold(s).includes(needle);
  }

  // Process start/end markers only respond to package/process terms; raw lines only show unfiltered.
  function term(key, neg, fn) {
    const procKey = key === 'package' || key === 'process';
    return {
      key,
      neg,
      fn: (e, t) => {
        if (e.marker && !procKey) return true;
        const r = fn(e, t);
        return neg ? !r : r;
      },
    };
  }

  function compileTerm(tok) {
    const m = !tok.literal && /^(-?)([a-z]+)(=:|~:|:)([\s\S]*)$/i.exec(tok.word);
    const key = m && m[2].toLowerCase();
    if (m && KEYS.includes(key)) {
      const neg = !!m[1], op = m[3], v = m[4];
      if (!v) return null; // still being typed
      if (TEXT_KEYS.has(key)) {
        if (key === 'package' || key === 'process') usesProc = true;
        if (key === 'package' && op === ':' && v === 'mine') {
          return term(key, neg, (e, t) => t.ds.mine.has(procOf(t, e).split(':')[0]));
        }
        const match = textMatcher(op, v);
        if (!match) return null;
        const get = {
          tag: e => e.tag,
          message: e => e.msg,
          package: (e, t) => procOf(t, e).split(':')[0],
          process: (e, t) => procOf(t, e),
          line: (e, t) => displayLine(t, e),
        }[key];
        if (key === 'message' && !neg) highlights.push(op === '~:' ? v : escapeRe(v));
        return term(key, neg, (e, t) => match(get(e, t)));
      }
      if (key === 'level') {
        const l = LEVEL_WORDS[v.toUpperCase()];
        if (!l) { errors.push(`Unknown level "${v}"`); return null; }
        const r = LEVEL_RANK[l];
        return term(key, neg, op === '=:' ? e => LEVEL_RANK[e.lvl] === r : e => LEVEL_RANK[e.lvl] >= r);
      }
      if (key === 'age') {
        const a = /^(\d+)([smhd])$/i.exec(v);
        if (!a) { errors.push(`Invalid age "${v}" (use 30s, 5m, 2h or 1d)`); return null; }
        const since = Date.now() - a[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[a[2].toLowerCase()];
        return term(key, neg, e => entryTime(e) >= since);
      }
      const test = IS_TESTS[v.toLowerCase()];
      if (!test) { errors.push(`Unknown "is:${v}"`); return null; }
      return term(key, neg, test);
    }
    // Free text: matches tag, package or message.
    let w = tok.word, neg = false;
    if (w.length > 1 && w[0] === '-') { neg = true; w = w.slice(1); }
    if (!w) return null;
    usesProc = true;
    const match = textMatcher(':', w);
    if (!neg) highlights.push(escapeRe(w));
    return term('text', neg, (e, t) => match(e.msg) || match(e.tag) || match(procOf(t, e)));
  }

  const toks = tokenize(query);
  let pos = 0;
  const peek = () => toks[pos];

  function parseOr() {
    const parts = [parseAnd()];
    while (peek() && peek().op === '|') { pos++; parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0] : (e, t) => parts.some(p => p(e, t));
  }

  function parseAnd() {
    const items = [];
    while (peek() && peek().op !== '|' && peek().op !== ')') {
      const tok = toks[pos++];
      if (tok.op === '&') continue;
      if (tok.op === '(') {
        const inner = parseOr();
        if (peek() && peek().op === ')') pos++; else errors.push('Missing ")"');
        items.push({ fn: inner });
        continue;
      }
      const c = compileTerm(tok);
      if (c) items.push(c);
    }
    // As in Android Studio, positive terms with the same key are OR-ed: tag:a tag:b → (tag:a | tag:b).
    const groups = new Map();
    const fns = [];
    for (const it of items) {
      if (it.key && TEXT_KEYS.has(it.key) && !it.neg) {
        let g = groups.get(it.key);
        if (!g) {
          g = [];
          groups.set(it.key, g);
          fns.push((e, t) => g.some(f => f(e, t)));
        }
        g.push(it.fn);
      } else {
        fns.push(it.fn);
      }
    }
    if (!fns.length) return () => true;
    return fns.length === 1 ? fns[0] : (e, t) => fns.every(f => f(e, t));
  }

  const roots = [parseOr()];
  while (pos < toks.length) { pos++; errors.push('Unexpected ")"'); roots.push(parseOr()); }
  const root = roots.length === 1 ? roots[0] : (e, t) => roots.every(r => r(e, t));
  const empty = !toks.length;

  let hl = null;
  if (highlights.length) {
    try { hl = new RegExp(highlights.join('|'), cs ? 'g' : 'gi'); } catch { /* invalid user regex */ }
  }
  return {
    test: (e, t) => (e.raw ? empty : root(e, t)),
    empty,
    error: errors[0] || '',
    hl,
    usesProc,
  };
}

// ---------- tabs ----------

let streamSeq = 0;
const streamOwners = new Map();   // stream id -> tab
let tabs = [];
let active = null;

class Tab {
  constructor(opts) {
    this.name = opts.name || 'Logcat';
    this.device = opts.device || '';
    this.query = opts.query || '';
    this.caseSens = !!opts.caseSens;
    // Package/process dropdown selection: [{ kind: 'package' | 'process' | 'mine', value }]; empty = all.
    this.procSel = opts.procSel || (opts.proc ? [opts.proc] : []);
    this.file = opts.file || null;             // imported file name → static tab without a device
    this.fileDs = { names: new Map(), running: new Set(), apps: new Set(), appNames: new Set(), mine: new Set() };
    this.streamId = 0;
    this.retryDelay = 1000;
    this.reconnectTimer = null;
    this.conn = { state: 'idle', msg: '' };
    this.follow = true;
    this.scrollTop = 0;
    this.nextId = 1;
    this.pausedAtId = Infinity;
    this.compile();
    this.reset();
  }

  get ds() { return this.file ? this.fileDs : devState(this.device); }
  get paused() { return this.pausedAtId !== Infinity; }

  reset() {
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
    if (this === active) queueRender();
  }

  compile() {
    this.filter = compileQuery(this.query, this.caseSens);
  }

  matches(e) {
    return e.id <= this.pausedAtId && this.procMatch(e) && this.filter.test(e, this);
  }

  // The package/process dropdown. Matching by name (not pid) keeps following an app across restarts.
  // A line passes if it comes from any selected package/process.
  procMatch(e) {
    const sel = this.procSel;
    if (!sel.length) return true;
    if (e.raw) return false;
    const name = procOf(this, e);
    if (!name) return false;
    const pkg = name.split(':')[0];
    return sel.some(p => (p.kind === 'process' ? name === p.value
      : p.kind === 'mine' ? this.ds.mine.has(pkg) : pkg === p.value));
  }

  setProcSel(sel) {
    this.procSel = sel;
    this.refilter();
    saveSettings();
    if (this === active) { renderProc(); renderEmpty(); }
  }

  toggleProc(p) {
    const has = this.procSel.some(x => sameProc(x, p));
    this.setProcSel(has ? this.procSel.filter(x => !sameProc(x, p)) : [...this.procSel, p]);
  }

  refilter() {
    this.compile();
    this.view = this.entries.filter(e => this.matches(e));
    this.tops = null;
    const visible = new Set(this.view.map(e => e.id));
    for (const id of this.selected) if (!visible.has(id)) this.selected.delete(id);
    if (this === active) queueRender();
  }

  setPaused(p) {
    this.pausedAtId = p ? this.nextId - 1 : Infinity;
    this.refilter();
    if (this === active) { renderToolbar(); renderNotice(); }
  }

  onProcsChanged() {
    if (this.filter.usesProc || this.procSel.length) this.refilter();
    else if (this === active) queueRender();
  }

  // ----- streaming -----

  setDevice(serial) {
    if (serial === this.device && this.streamId) return;
    this.disconnect();
    this.device = serial;
    this.reset();
    this.retryDelay = 1000;
    this.connect();
    saveSettings();
    if (this === active) { renderDevice(); renderProc(); renderNotice(); }
    refreshProcs();
  }

  connect() {
    this.disconnect();
    if (this.file || !this.device) return;
    const opts = { serial: this.device, buffer: settings.buffer };
    if (this.lastStamp) {
      opts.since = this.lastStamp.slice(5); // logcat -T wants MM-DD hh:mm:ss.mmm
      this.resumeStamp = this.lastStamp;
    } else {
      opts.tail = 5000;
    }
    this.streamId = ++streamSeq;
    streamOwners.set(this.streamId, this);
    api.start(this.streamId, opts);
    this.setConn('live');
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.streamId) {
      api.stop(this.streamId);
      streamOwners.delete(this.streamId);
      this.streamId = 0;
    }
  }

  restart() {
    this.disconnect();
    this.reset();
    this.retryDelay = 1000;
    this.connect();
  }

  dropped(msg) {
    this.disconnect();
    this.setConn('reconnecting', msg);
    this.reconnectTimer = setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 8000);
  }

  setConn(state, msg = '') {
    this.conn = { state, msg };
    if (this === active) renderNotice();
  }

  dispose() {
    this.disconnect();
  }

  // ----- ingest -----

  push(e) {
    this.entries.push(e);
    if (this.matches(e)) this.view.push(e);
  }

  ingest(batch) {
    const ds = this.ds;
    for (const item of batch) {
      if (typeof item === 'string') {
        // Markers like "--------- beginning of main" repeat on every resume; keep only the first ones.
        if (item.trim() && !this.resumeStamp) this.push({ id: this.nextId++, marker: true, raw: true, pid: '', msg: item });
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
    if (this === active) queueRender();
  }

  // Mirror Android Studio's "PROCESS STARTED / ENDED" lines from ActivityManager events.
  processEvent(msg, ds) {
    let m = START_RE.exec(msg);
    if (m) {
      const [, pid, name] = m;
      ds.names.set(pid, name);
      ds.appNames.add(name); // ActivityManager only starts app processes
      this.endedPids.delete(pid);
      this.push({ id: this.nextId++, marker: true, pid, proc: name, msg: `PROCESS STARTED (${pid}) for package ${name}` });
      return;
    }
    let pid, name;
    if ((m = DIED_RE.exec(msg))) [, name, pid] = m;
    else if ((m = KILL_RE.exec(msg))) [, pid, name] = m;
    else return;
    if (this.endedPids.has(pid)) return;
    this.endedPids.add(pid);
    this.push({ id: this.nextId++, marker: true, pid, proc: name, msg: `PROCESS ENDED (${pid}) for package ${name}` });
  }

  trim() {
    if (this.entries.length <= MAX_ENTRIES * 1.1) return;
    const drop = this.entries.length - MAX_ENTRIES;
    const minId = this.entries[drop].id;
    this.entries = this.entries.slice(drop);
    const removed = firstIndexAtLeast(this.view, minId);
    if (removed) {
      const removedPx = rowTop(this, removed);
      this.view = this.view.slice(removed);
      this.tops = null;
      if (this === active && !this.follow) els.log.scrollTop = Math.max(0, els.log.scrollTop - removedPx);
    }
    for (const id of this.selected) if (id < minId) this.selected.delete(id);
  }
}

api.onLines((id, batch) => {
  const t = streamOwners.get(id);
  if (t && t.streamId === id) { t.retryDelay = 1000; t.ingest(batch); }
});
api.onEnd((id, info) => {
  const t = streamOwners.get(id);
  if (t && t.streamId === id) t.dropped((info && info.error) || 'logcat ended');
});

function addTab(opts, activate = true) {
  const t = new Tab(opts);
  tabs.push(t);
  if (activate) activateTab(t);
  if (!t.file && t.device) { t.connect(); refreshProcs(); }
  renderTabs();
  saveSettings();
  return t;
}

function closeTab(t) {
  const i = tabs.indexOf(t);
  if (i < 0) return;
  t.dispose();
  tabs.splice(i, 1);
  if (!tabs.length) {
    addTab({ device: t.device });
    return;
  }
  if (active === t) activateTab(tabs[Math.min(i, tabs.length - 1)]);
  renderTabs();
  saveSettings();
}

function activateTab(t) {
  if (active) active.scrollTop = els.log.scrollTop;
  active = t;
  els.query.value = t.query;
  hideSuggest();
  renderTabs();
  renderDevice();
  renderProc();
  renderQueryBox();
  renderToolbar();
  renderNotice();
  render();
  if (!t.follow) els.log.scrollTop = t.scrollTop;
  saveSettings();
}

// ---------- layout (fixed rows, or variable rows when soft-wrapping) ----------

const metrics = { key: '', charW: 7.5, cpl: 100 };

function measure() {
  const w = els.log.clientWidth;
  const f = settings.format;
  const key = `${w}|${f.date}|${f.pid}|${f.tag}|${f.pkg}`;
  if (key === metrics.key) return;
  metrics.key = key;
  metrics.charW = els.probe.getBoundingClientRect().width / 100 || 7.5;
  const prefix = (f.date ? COLW.date : COLW.time) + (f.pid ? COLW.pid : 0) + (f.tag ? COLW.tag : 0) +
    (f.pkg ? COLW.pkg : 0) + COLW.lvl;
  metrics.cpl = Math.max(20, Math.floor((w - 16) / metrics.charW) - prefix);
  document.documentElement.style.setProperty('--cpl', metrics.cpl);
  for (const t of tabs) t.tops = null;
}

function rowLines(e) {
  return !settings.wrap || e.marker ? 1 : Math.max(1, Math.ceil(e.msg.length / metrics.cpl));
}

function ensureLayout(t) {
  if (!settings.wrap) return;
  if (!t.tops) t.tops = [0];
  const tops = t.tops;
  for (let i = tops.length - 1; i < t.view.length; i++) tops.push(tops[i] + rowLines(t.view[i]) * ROW_H);
}

function rowTop(t, i) {
  if (!settings.wrap) return i * ROW_H;
  ensureLayout(t);
  return t.tops[i];
}

function indexAtY(t, y) {
  if (!settings.wrap) return Math.floor(y / ROW_H);
  const tops = t.tops;
  let lo = 0, hi = t.view.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

// ---------- rendering ----------

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function highlight(t, s) {
  const re = t.filter.hl;
  if (!re) return esc(s);
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

function markerText(e) {
  return e.raw ? e.msg : `---------------------------- ${e.msg} ----------------------------`;
}

function rowHtml(t, e) {
  const sel = t.selected.has(e.id) ? ' sel' : '';
  if (e.marker) {
    return `<div class="row marker${e.raw ? '' : ' proc'}${sel}" data-id="${e.id}">${esc(markerText(e))}</div>`;
  }
  const lines = rowLines(e);
  const style = lines > 1 ? ` style="height:${lines * ROW_H}px"` : '';
  const f = settings.format;
  const proc = esc(procOf(t, e));
  const tag = esc(e.tag);
  return `<div class="row L${e.lvl}${sel}" data-id="${e.id}"${style}>` +
    `<span class="c-time">${f.date ? e.date + ' ' : ''}${e.time}</span>` +
    `<span class="c-pid">${e.pid}-${e.tid}</span>` +
    `<span class="c-tag ${tagClass(e.tag)}" title="${tag}">${tag}</span>` +
    `<span class="c-pkg" title="${proc}">${proc}</span>` +
    `<span class="c-lvl"><b>${e.lvl}</b></span>` +
    `<span class="c-msg">${highlight(t, e.msg)}</span></div>`;
}

function render() {
  renderQueued = false;
  const t = active;
  if (!t) return;
  measure();
  const n = t.view.length;
  ensureLayout(t);
  const total = rowTop(t, n);
  els.spacer.style.height = total + 'px';
  if (t.follow) els.log.scrollTop = els.log.scrollHeight;
  const top = els.log.scrollTop;
  const bottom = top + els.log.clientHeight + 4 * ROW_H;
  const start = Math.max(0, Math.min(n, indexAtY(t, top)) - 4);
  let end = start;
  while (end < n && rowTop(t, end) < bottom) end++;
  let html = '';
  for (let i = start; i < end; i++) html += rowHtml(t, t.view[i]);
  els.rows.style.transform = `translateY(${rowTop(t, start)}px)`;
  els.rows.innerHTML = html;
  updateHover();
  els.follow.hidden = t.follow || n === 0;
  renderEmpty();
}

// Hover highlight follows the pointer position rather than CSS :hover, so it stays steady
// while rows are rebuilt for streaming logs.
let pointerY = null;

function updateHover() {
  let id = null;
  const t = active;
  if (pointerY !== null && t && t.view.length) {
    const y = pointerY - els.log.getBoundingClientRect().top + els.log.scrollTop;
    const i = indexAtY(t, y);
    if (y >= 0 && i >= 0 && i < t.view.length && y < rowTop(t, t.view.length)) id = String(t.view[i].id);
  }
  for (const row of els.rows.children) row.classList.toggle('hover', row.dataset.id === id);
}

els.log.addEventListener('mousemove', ev => { pointerY = ev.clientY; updateHover(); });
els.log.addEventListener('mouseleave', () => { pointerY = null; updateHover(); });

function renderEmpty() {
  const t = active;
  let text = '';
  if (!t.file && !t.device) {
    text = devices.error ? `adb error: ${devices.error}` : 'No connected devices. Connect a device with USB debugging enabled.';
  } else if (!t.view.length && t.procSel.length && !t.file &&
             t.procSel.every(p => p.kind !== 'mine' && !procPids(t, p).length)) {
    const names = t.procSel.map(p => p.value).join(', ');
    text = `${names} ${t.procSel.length > 1 ? 'are' : 'is'} not running. Logs will appear here when ${t.procSel.length > 1 ? 'they start' : 'it starts'}.`;
  } else if (!t.view.length && t.entries.length && (!t.filter.empty || t.procSel.length)) {
    text = 'No log lines match the filter.';
  }
  els.empty.textContent = text;
  els.empty.hidden = !text;
}

function renderNotice() {
  const t = active;
  let text = '';
  if (t.paused) {
    const waiting = t.entries.length - firstIndexAtLeast(t.entries, t.pausedAtId + 1);
    text = `Logcat is paused${waiting ? ` · ${waiting.toLocaleString()} new lines` : ''}. Press Space or ▶ to resume.`;
  } else if (!t.file && t.device && t.conn.state === 'reconnecting') {
    text = deviceOnline(t.device)
      ? `Logcat stopped (${t.conn.msg}). Reconnecting…`
      : 'Device disconnected. Waiting for it to come back…';
  }
  els.notice.textContent = text;
  els.notice.hidden = !text;
}

function renderTabs() {
  els.tabs.innerHTML = tabs.map((t, i) =>
    `<div class="tab${t === active ? ' active' : ''}" data-i="${i}" title="${esc(t.file ? t.file : t.name)}">` +
    `<span class="tab-name">${esc(t.name)}</span>` +
    `<button class="tab-close" data-close="${i}" title="Close tab"><svg><use href="#i-close"/></svg></button></div>`,
  ).join('');
}

function renderDevice() {
  const t = active;
  if (!t) return;
  let main, sub;
  if (t.file) {
    main = t.file;
    sub = 'Imported file';
  } else if (t.device) {
    ({ main, sub } = deviceText(t.device));
  } else {
    main = devices.list.length ? 'Select a device' : 'No connected devices';
    sub = '';
  }
  els.deviceIcon.setAttribute('href', t.file ? '#i-file' : '#i-phone');
  els.deviceLabel.textContent = main;
  els.deviceSub.textContent = sub;
  els.deviceBtn.title = sub ? `${main} ${sub}` : main;
  syncMirror();
}

// The mirroring panel shows the active tab's device.
function syncMirror() {
  const t = active;
  const serial = t && !t.file ? t.device : '';
  const info = serial && devices.info.get(serial);
  MirrorView.update({
    serial,
    label: info && info.model ? `${capitalize(info.manufacturer)} ${info.model}` : serial,
    online: !!serial && deviceOnline(serial),
  });
  els.mirror.classList.toggle('on', MirrorView.isOpen());
}

const PKG_RE = /^[a-z][\w]*(\.[\w]+)+$/i;

function runningPids(ds, match) {
  return [...ds.running].filter(pid => match(ds.names.get(pid) || '')).sort((a, b) => a - b);
}

function procPids(t, p) {
  return runningPids(t.ds, name => (p.kind === 'process' ? name === p.value : name.split(':')[0] === p.value));
}

function sameProc(a, b) {
  return a.kind === b.kind && a.value === b.value;
}

function procName(p) {
  return p.kind === 'mine' ? 'Installed apps' : p.value;
}

function procStatus(t, p) {
  if (p.kind === 'mine') return 'package:mine';
  if (t.file) return '';
  const pids = procPids(t, p);
  return pids.length ? pids.join(', ') : 'not running';
}

function renderProc() {
  const t = active;
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

// Rows for the package/process dropdown: running apps first, then apps seen earlier, then system processes.
function procChoices(t) {
  const ds = t.ds;
  const running = new Map();   // package -> pids
  const system = new Map();    // process name -> pids
  // Prefer the app-user info from ps; fall back to "looks like a package name" if it's unavailable.
  const isApp = (pid, pkg) => (ds.apps.size ? ds.apps.has(pid) : PKG_RE.test(pkg));
  for (const pid of ds.running) {
    const name = ds.names.get(pid);
    if (!name) continue;
    const pkg = name.split(':')[0];
    if (isApp(pid, pkg)) (running.get(pkg) || running.set(pkg, []).get(pkg)).push(pid);
    else (system.get(name) || system.set(name, []).get(name)).push(pid);
  }
  const seen = new Set();
  for (const name of ds.appNames) {
    const pkg = name.split(':')[0];
    if (!running.has(pkg)) seen.add(pkg);
  }
  const sortKeys = m => [...m.keys()].sort((a, b) => a.localeCompare(b));
  const pidHint = pids => pids.sort((a, b) => a - b).join(', ');
  return {
    running: sortKeys(running).map(pkg => ({ kind: 'package', value: pkg, hint: pidHint(running.get(pkg)), mine: ds.mine.has(pkg) })),
    stopped: [...seen].sort().map(pkg => ({ kind: 'package', value: pkg, hint: 'not running', dead: true })),
    system: sortKeys(system).map(name => ({ kind: 'process', value: name, hint: pidHint(system.get(name)) })),
  };
}

function openProcMenu() {
  if (menuEl && els.procBtn.classList.contains('open')) { closeMenu(); return; }
  const t = active;
  const choices = procChoices(t);
  const box = document.createElement('div');
  box.innerHTML = '<div class="menu-search"><svg><use href="#i-search"/></svg>' +
    '<input placeholder="Search packages and processes" spellcheck="false"></div><div class="proc-list"></div>';
  const input = box.querySelector('input');
  const list = box.querySelector('.proc-list');
  let rows = [];          // proc per row; null = "All processes"
  let activeIdx = 0;
  const isSel = p => t.procSel.some(x => sameProc(x, p));

  // Toggling keeps the menu open so several processes can be picked in one go.
  function toggle(p) {
    if (p === null) t.setProcSel([]);
    else t.toggleProc(p);
    draw(p);
  }

  function draw(keep) {
    const q = input.value.trim().toLowerCase();
    const has = c => !q || c.value.toLowerCase().includes(q);
    const notSel = c => !isSel(c);
    const mine = { kind: 'mine', value: 'mine', label: 'Installed apps', hint: 'package:mine' };
    const selected = t.procSel.map(p => ({ ...p, label: procName(p), hint: procStatus(t, p), dead: procStatus(t, p) === 'not running' }));
    const sections = [
      [null, [{ label: 'All processes', all: true }, ...(isSel(mine) ? [] : [mine])].filter(r => !q || r.label.toLowerCase().includes(q))],
      ['Selected', selected.filter(c => !q || c.label.toLowerCase().includes(q))],
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
        const proc = it.all ? null : { kind: it.kind, value: it.value };
        const on = it.all ? !t.procSel.length : isSel(proc);
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

  function highlightRow(scroll = true) {
    list.querySelectorAll('.item[data-i]').forEach(el => el.classList.toggle('active', Number(el.dataset.i) === activeIdx));
    const el = list.querySelector(`.item[data-i="${activeIdx}"]`);
    if (el && scroll) el.scrollIntoView({ block: 'nearest' });
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
    const el = ev.target.closest('.item[data-i]');
    if (el) toggle(rows[Number(el.dataset.i)]);
  });

  menuBelow(els.procBtn, [{ node: box }], 'proc-menu');
  els.procBtn.classList.add('open');
  draw();
  input.focus();
}

els.procBtn.addEventListener('click', ev => {
  if (ev.target.closest('#procClear')) { closeMenu(); active.setProcSel([]); return; }
  openProcMenu();
});

function renderQueryBox() {
  const t = active;
  els.queryClear.hidden = !els.query.value;
  els.caseBtn.classList.toggle('on', t.caseSens);
  els.queryBox.classList.toggle('invalid', !!t.filter.error);
  els.queryBox.title = t.filter.error;
  const fav = !!t.query.trim() && settings.favorites.includes(t.query.trim());
  els.favBtn.classList.toggle('on', fav);
  els.favBtn.title = fav ? 'Remove filter from favorites' : 'Add filter to favorites';
}

function renderToolbar() {
  const t = active;
  els.pauseIcon.setAttribute('href', t.paused ? '#i-play' : '#i-pause');
  els.pause.title = t.paused ? 'Resume Logcat (Space)' : 'Pause Logcat (Space)';
  els.pause.classList.toggle('on', t.paused);
  els.wrap.classList.toggle('on', settings.wrap);
  const live = !t.file && !!t.device;
  els.restart.disabled = !live;
  els.shot.disabled = !live || !deviceOnline(t.device);
}

function applyFormat() {
  const f = settings.format;
  const root = document.documentElement.style;
  root.setProperty('--w-time', (f.date ? COLW.date : COLW.time) + 'ch');
  root.setProperty('--w-pid', COLW.pid + 'ch');
  root.setProperty('--w-tag', COLW.tag + 'ch');
  root.setProperty('--w-pkg', COLW.pkg + 'ch');
  root.setProperty('--w-lvl', COLW.lvl + 'ch');
  els.log.classList.toggle('hide-pid', !f.pid);
  els.log.classList.toggle('hide-tag', !f.tag);
  els.log.classList.toggle('hide-pkg', !f.pkg);
  els.log.classList.toggle('wrap', settings.wrap);
  metrics.key = '';
  for (const t of tabs) t.tops = null;
  if (active) { renderToolbar(); queueRender(); }
}

// ---------- menus ----------

let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  els.deviceBtn.classList.remove('open');
  els.procBtn.classList.remove('open');
}
document.addEventListener('mousedown', ev => { if (menuEl && !menuEl.contains(ev.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

// items: '-' | { header } | { label, hint, checked, disabled, action, remove }
function showMenu(x, y, items, cls = '') {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu ' + cls;
  const checks = items.some(it => it && it.checked !== undefined);
  for (const it of items) {
    if (it === '-') { m.appendChild(Object.assign(document.createElement('div'), { className: 'sep' })); continue; }
    if (it.header) { m.appendChild(Object.assign(document.createElement('div'), { className: 'menu-header', textContent: it.header })); continue; }
    if (it.node) { m.appendChild(it.node); continue; }
    const el = document.createElement('div');
    el.className = 'item' + (it.disabled ? ' disabled' : '');
    el.innerHTML = (checks ? `<span class="check">${it.checked ? '<svg><use href="#i-check"/></svg>' : ''}</span>` : '') +
      '<span class="label"></span>' + (it.hint ? '<span class="hint"></span>' : '') +
      (it.remove ? '<span class="remove" title="Remove"><svg><use href="#i-close"/></svg></span>' : '');
    el.querySelector('.label').textContent = it.label;
    if (it.hint) el.querySelector('.hint').textContent = it.hint;
    el.addEventListener('click', ev => {
      if (it.remove && ev.target.closest('.remove')) { closeMenu(); it.remove(); return; }
      closeMenu();
      if (it.action) it.action();
    });
    m.appendChild(el);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = (y + r.height > innerHeight - 4 ? Math.max(4, y - r.height) : y) + 'px';
  menuEl = m;
  return m;
}

function menuBelow(el, items, cls) {
  const r = el.getBoundingClientRect();
  return showMenu(r.left, r.bottom + 4, items, cls);
}

els.deviceBtn.addEventListener('click', () => {
  if (menuEl && els.deviceBtn.classList.contains('open')) { closeMenu(); return; }
  const t = active;
  const items = [];
  if (t.file) {
    items.push({ label: t.file, hint: 'Imported file', checked: true, disabled: true });
  } else {
    const serials = devices.list.map(d => d.serial);
    if (t.device && !serials.includes(t.device)) serials.push(t.device);
    for (const serial of serials) {
      const { main, sub } = deviceText(serial);
      items.push({ label: main, hint: sub, checked: serial === t.device, disabled: !deviceOnline(serial) && serial !== t.device, action: () => t.setDevice(serial) });
    }
    if (!items.length) items.push({ label: devices.error ? `adb error: ${devices.error}` : 'No connected devices', disabled: true });
  }
  menuBelow(els.deviceBtn, items);
  els.deviceBtn.classList.add('open');
});

// ---------- tabs strip ----------

els.tabs.addEventListener('mousedown', ev => {
  if (ev.button === 1) { // middle-click closes, like the IDE
    const tabEl = ev.target.closest('.tab');
    if (tabEl) { ev.preventDefault(); closeTab(tabs[Number(tabEl.dataset.i)]); }
  }
});
els.tabs.addEventListener('click', ev => {
  const close = ev.target.closest('[data-close]');
  if (close) { closeTab(tabs[Number(close.dataset.close)]); return; }
  const tabEl = ev.target.closest('.tab');
  if (tabEl && tabs[Number(tabEl.dataset.i)] !== active) activateTab(tabs[Number(tabEl.dataset.i)]);
});
els.tabs.addEventListener('dblclick', ev => {
  const tabEl = ev.target.closest('.tab');
  if (tabEl) renameTab(tabs[Number(tabEl.dataset.i)], tabEl);
});
els.tabs.addEventListener('contextmenu', ev => {
  const tabEl = ev.target.closest('.tab');
  if (!tabEl) return;
  ev.preventDefault();
  const t = tabs[Number(tabEl.dataset.i)];
  showMenu(ev.clientX, ev.clientY, [
    { label: 'Rename Tab', action: () => renameTab(t, tabEl) },
    { label: 'Close Tab', action: () => closeTab(t) },
    { label: 'Close Other Tabs', disabled: tabs.length < 2, action: () => tabs.filter(x => x !== t).forEach(closeTab) },
  ]);
});

function renameTab(t, tabEl) {
  const name = tabEl.querySelector('.tab-name');
  const input = document.createElement('input');
  input.value = t.name;
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) t.name = input.value.trim();
    renderTabs();
    saveSettings();
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

els.addTab.addEventListener('click', () => addTab({ device: active && !active.file ? active.device : '' }));
api.onMenu('newTab', () => els.addTab.click());

// ---------- query box ----------

let queryTimer = null;
function applyQuery() {
  clearTimeout(queryTimer);
  active.query = els.query.value;
  active.refilter();
  renderQueryBox();
  renderEmpty();
  saveSettings();
}

els.query.addEventListener('input', () => {
  els.queryClear.hidden = !els.query.value;
  clearTimeout(queryTimer);
  queryTimer = setTimeout(applyQuery, 150);
  updateSuggest();
});

function commitHistory() {
  const q = els.query.value.trim();
  if (!q) return;
  settings.history = [q, ...settings.history.filter(h => h !== q)].slice(0, 20);
  saveSettings();
}
els.query.addEventListener('blur', () => { commitHistory(); setTimeout(hideSuggest, 150); });

els.queryClear.addEventListener('click', () => {
  els.query.value = '';
  applyQuery();
  els.query.focus();
});

els.caseBtn.addEventListener('click', () => {
  active.caseSens = !active.caseSens;
  active.refilter();
  renderQueryBox();
  saveSettings();
});

els.favBtn.addEventListener('click', () => {
  const q = els.query.value.trim();
  if (!q) return;
  settings.favorites = settings.favorites.includes(q)
    ? settings.favorites.filter(f => f !== q)
    : [q, ...settings.favorites];
  renderQueryBox();
  saveSettings();
});

function setQuery(q) {
  els.query.value = q;
  applyQuery();
}

els.filterMenu.addEventListener('click', () => {
  const items = [];
  if (settings.favorites.length) {
    items.push({ header: 'Favorites' });
    for (const f of settings.favorites) {
      items.push({ label: f, action: () => setQuery(f), remove: () => { settings.favorites = settings.favorites.filter(x => x !== f); renderQueryBox(); saveSettings(); } });
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
});

els.helpBtn.addEventListener('click', () => {
  const node = els.helpTpl.content.firstElementChild.cloneNode(true);
  const r = els.helpBtn.getBoundingClientRect();
  showMenu(r.right - 620, r.bottom + 4, [{ node }], 'help-menu');
});

function addQueryTerm(term) {
  const q = els.query.value.trim();
  setQuery(q ? `${q} ${term}` : term);
}

// ----- autocomplete -----

const KEY_HINTS = [
  ['tag', 'Log tag'], ['package', 'App package'], ['process', 'Process name'], ['message', 'Log message'],
  ['line', 'Whole log line'], ['level', 'Minimum log level'], ['age', 'Recent lines, e.g. 5m'], ['is', 'crash / stacktrace'],
];
let suggestState = null;

function currentToken() {
  const v = els.query.value;
  const end = els.query.selectionStart;
  let start = end;
  while (start > 0 && !/[\s()|&]/.test(v[start - 1])) start--;
  return { start, end, text: v.slice(start, end) };
}

function valuesFor(key) {
  const t = active;
  const ds = t.ds;
  const running = [...ds.running].map(pid => ds.names.get(pid)).filter(Boolean);
  switch (key) {
    case 'tag': return [...t.tagCounts].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
    case 'package': {
      const apps = ds.apps.size ? [...ds.apps].map(pid => ds.names.get(pid)).filter(Boolean) : running;
      const pkgs = new Set(apps.map(n => n.split(':')[0]).filter(n => PKG_RE.test(n)));
      return ['mine', ...[...pkgs].sort()];
    }
    case 'process': return [...new Set(running)].sort();
    case 'level': return ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'ASSERT'];
    case 'is': return ['crash', 'stacktrace'];
    case 'age': return ['30s', '1m', '5m', '15m', '1h', '1d'];
    default: return [];
  }
}

function updateSuggest(force = false) {
  const tok = currentToken();
  let items = [];
  const m = /^(-?)([a-z]+)(=:|~:|:)(.*)$/i.exec(tok.text);
  if (m && KEYS.includes(m[2].toLowerCase())) {
    const prefix = m[1] + m[2] + m[3];
    const typed = m[4].replace(/^"/, '').toLowerCase();
    items = valuesFor(m[2].toLowerCase())
      .filter(v => v.toLowerCase().includes(typed) && v.toLowerCase() !== typed)
      .slice(0, 40)
      .map(v => ({ label: v, insert: prefix + quoteIfNeeded(v) + ' ' }));
  } else if (/^-?[a-z]*$/i.test(tok.text) && (tok.text || force)) {
    const neg = tok.text.startsWith('-') ? '-' : '';
    const w = tok.text.replace(/^-/, '').toLowerCase();
    items = KEY_HINTS.filter(([k]) => k.startsWith(w) && k !== w)
      .map(([k, hint]) => ({ label: neg + k + ':', hint, insert: neg + k + ':', reopen: true }));
  }
  if (!items.length) { hideSuggest(); return; }
  suggestState = { tok, items, index: 0 };
  els.suggest.innerHTML = items.map((it, i) =>
    `<div class="item${i === 0 ? ' active' : ''}" data-i="${i}"><span class="label">${esc(it.label)}</span>` +
    (it.hint ? `<span class="hint">${esc(it.hint)}</span>` : '') + '</div>').join('');
  els.suggest.hidden = false;
  // Place the popup under the token being completed.
  const r = els.query.getBoundingClientRect();
  const ctx = (updateSuggest.ctx ||= document.createElement('canvas').getContext('2d'));
  ctx.font = getComputedStyle(els.query).font;
  const x = r.left + 4 + ctx.measureText(els.query.value.slice(0, tok.start)).width - els.query.scrollLeft;
  els.suggest.style.left = Math.max(4, Math.min(x, innerWidth - els.suggest.offsetWidth - 4)) + 'px';
  els.suggest.style.top = r.bottom + 6 + 'px';
}

function hideSuggest() {
  suggestState = null;
  els.suggest.hidden = true;
}

function moveSuggest(d) {
  const s = suggestState;
  s.index = (s.index + d + s.items.length) % s.items.length;
  els.suggest.querySelectorAll('.item').forEach((el, i) => el.classList.toggle('active', i === s.index));
  els.suggest.children[s.index].scrollIntoView({ block: 'nearest' });
}

function acceptSuggest(i = suggestState.index) {
  const { tok, items } = suggestState;
  const it = items[i];
  const v = els.query.value;
  const after = v.slice(tok.end).replace(/^\S*/, '');
  els.query.value = v.slice(0, tok.start) + it.insert + after.replace(/^\s+/, it.insert.endsWith(' ') ? '' : ' ');
  const caret = tok.start + it.insert.length;
  els.query.setSelectionRange(caret, caret);
  hideSuggest();
  clearTimeout(queryTimer);
  queryTimer = setTimeout(applyQuery, 50);
  els.queryClear.hidden = false;
  if (it.reopen) updateSuggest();
}

els.suggest.addEventListener('mousedown', ev => {
  ev.preventDefault(); // keep focus in the query box
  const item = ev.target.closest('.item');
  if (item) acceptSuggest(Number(item.dataset.i));
});

els.query.addEventListener('keydown', ev => {
  if (ev.key === ' ' && ev.ctrlKey) { ev.preventDefault(); updateSuggest(true); return; }
  if (suggestState) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveSuggest(1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); moveSuggest(-1); return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acceptSuggest(); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); hideSuggest(); return; }
  }
  if (ev.key === 'Enter') { applyQuery(); commitHistory(); }
});
els.query.addEventListener('click', () => { if (suggestState) updateSuggest(); });

// ---------- log view interaction ----------

els.log.addEventListener('scroll', () => {
  active.follow = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - ROW_H;
  queueRender();
});
new ResizeObserver(() => queueRender()).observe(els.log);

function scrollToEnd() {
  active.follow = true;
  queueRender();
}
els.follow.addEventListener('click', scrollToEnd);

function entryAt(target) {
  const row = target.closest('.row');
  if (!row) return null;
  const t = active;
  const e = t.view[firstIndexAtLeast(t.view, Number(row.dataset.id))];
  return e && e.id === Number(row.dataset.id) ? e : null;
}

els.rows.addEventListener('mousedown', ev => {
  if (ev.button !== 0) return;
  const e = entryAt(ev.target);
  if (!e) return;
  const t = active;
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
  t.follow = false; // keep the clicked line in place
  els.log.focus();
  queueRender();
});

els.rows.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  const e = entryAt(ev.target);
  if (!e) return;
  const t = active;
  if (!t.selected.has(e.id)) { t.selected.clear(); t.selected.add(e.id); t.anchorId = e.id; queueRender(); }
  const proc = procOf(t, e);
  const pkg = proc.split(':')[0];
  const items = [
    { label: 'Copy', hint: 'Ctrl+C', action: copySelection },
    { label: 'Copy Message', disabled: !!e.marker, action: () => copyText(selectedEntries().filter(x => !x.marker).map(x => x.msg).join('\n')) },
  ];
  if (!e.marker && e.tag) {
    items.push('-',
      { label: `Filter tag: ${e.tag}`, action: () => addQueryTerm('tag:' + quoteIfNeeded(e.tag)) },
      { label: `Exclude tag: ${e.tag}`, action: () => addQueryTerm('-tag:' + quoteIfNeeded(e.tag)) });
    const text = messageTerm(e.msg);
    if (text) {
      items.push({
        label: `Exclude message: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`,
        action: () => addQueryTerm('-message:' + quoteIfNeeded(text)),
      });
    }
  }
  if (pkg) {
    const kind = PKG_RE.test(pkg) ? 'package' : 'process';
    const value = kind === 'package' ? pkg : proc;
    const p = { kind, value };
    const selected = t.procSel.some(x => sameProc(x, p));
    items.push('-', { label: `Show only ${kind}: ${value}`, action: () => t.setProcSel([p]) });
    if (t.procSel.length && !selected) items.push({ label: `Add ${kind} to selection: ${value}`, action: () => t.toggleProc(p) });
    if (selected && t.procSel.length > 1) items.push({ label: `Remove ${kind} from selection: ${value}`, action: () => t.toggleProc(p) });
    items.push({ label: `Exclude ${kind}: ${value}`, action: () => addQueryTerm(`-${kind}:${quoteIfNeeded(value)}`) });
  }
  items.push('-', { label: 'Select All', hint: 'Ctrl+A', action: selectAll });
  showMenu(ev.clientX, ev.clientY, items);
});

function selectedEntries() {
  return active.view.filter(e => active.selected.has(e.id));
}

function displayLine(t, e) {
  if (e.marker) return markerText(e);
  return `${e.date} ${e.time} ${`${e.pid}-${e.tid}`.padEnd(COLW.pid)}${e.tag.padEnd(COLW.tag - 1)} ` +
    `${procOf(t, e).padEnd(COLW.pkg - 1)} ${e.lvl}  ${e.msg}`;
}

// threadtime with a year prefix, which Import (and other logcat tools) can read back.
function exportLine(e) {
  if (e.marker) return markerText(e);
  return `${e.date} ${e.time} ${e.pid.padStart(5)} ${e.tid.padStart(5)} ${e.lvl} ${e.tag}: ${e.msg}`;
}

async function copyText(text) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { toast('Copy failed'); }
}

function copySelection() {
  copyText(selectedEntries().map(e => displayLine(active, e)).join('\n'));
}

function selectAll() {
  for (const e of active.view) active.selected.add(e.id);
  queueRender();
}

function jumpToError(dir) {
  const t = active, v = t.view;
  if (!v.length) return;
  let i = t.anchorId !== null ? firstIndexAtLeast(v, t.anchorId) : (dir < 0 ? v.length : indexAtY(t, els.log.scrollTop) - 1);
  for (i += dir; i >= 0 && i < v.length; i += dir) {
    if (!v[i].marker && LEVEL_RANK[v[i].lvl] >= LEVEL_RANK.E) break;
  }
  if (i < 0 || i >= v.length) { toast(dir < 0 ? 'No earlier errors' : 'No later errors'); return; }
  t.selected.clear();
  t.selected.add(v[i].id);
  t.anchorId = v[i].id;
  t.follow = false;
  els.log.scrollTop = rowTop(t, i) - els.log.clientHeight / 3;
  queueRender();
}

// ---------- toolbar ----------

els.clear.addEventListener('click', async () => {
  const t = active;
  t.reset();
  renderNotice();
  if (t.file || !t.device) return;
  try { await api.clear(t.device, settings.buffer); } catch (e) { toast('Clear failed: ' + e.message); }
});

els.pause.addEventListener('click', () => active.setPaused(!active.paused));
els.restart.addEventListener('click', () => active.restart());
els.end.addEventListener('click', scrollToEnd);
els.prev.addEventListener('click', () => jumpToError(-1));
els.next.addEventListener('click', () => jumpToError(1));

els.wrap.addEventListener('click', () => {
  settings.wrap = !settings.wrap;
  applyFormat();
  saveSettings();
});

async function exportLog() {
  const t = active;
  const text = t.view.map(exportLine).join('\n') + '\n';
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const base = t.file ? t.file.replace(/\.\w+$/, '') + '-filtered' : `logcat-${(t.device || 'device').replace(/[^\w.-]/g, '_')}-${stamp}`;
  try {
    const saved = await api.saveFile(base + '.txt', text);
    if (saved) toast(`Saved ${t.view.length.toLocaleString()} lines to ${saved}`);
  } catch (e) {
    toast('Export failed: ' + e.message);
  }
}
els.exportBtn.addEventListener('click', exportLog);
api.onMenu('save', exportLog);

async function importLog() {
  let res;
  try { res = await api.importFile(); } catch (e) { toast('Import failed: ' + e.message); return; }
  if (!res) return;
  const t = addTab({ name: res.name, file: res.name });
  t.ingest(res.lines);
  t.follow = false;
  els.log.scrollTop = 0;
  toast(`Imported ${t.entries.length.toLocaleString()} lines`);
}
els.importBtn.addEventListener('click', importLog);
api.onMenu('import', importLog);

els.format.addEventListener('click', () => {
  const f = settings.format;
  const set = patch => { Object.assign(settings.format, patch); applyFormat(); saveSettings(); };
  const standard = f.date && f.pid && f.tag && f.pkg;
  const compact = !f.date && !f.pid && f.tag && !f.pkg;
  const r = els.format.getBoundingClientRect();
  showMenu(r.right + 4, r.top, [
    { label: 'Standard View', checked: standard, action: () => set({ date: true, pid: true, tag: true, pkg: true }) },
    { label: 'Compact View', checked: compact, action: () => set({ date: false, pid: false, tag: true, pkg: false }) },
    '-',
    { label: 'Show Date', checked: f.date, action: () => set({ date: !f.date }) },
    { label: 'Show Process and Thread IDs', checked: f.pid, action: () => set({ pid: !f.pid }) },
    { label: 'Show Tag', checked: f.tag, action: () => set({ tag: !f.tag }) },
    { label: 'Show Package Name', checked: f.pkg, action: () => set({ pkg: !f.pkg }) },
    '-',
    { header: 'Log Buffer' },
    ...BUFFERS.map(b => ({
      label: b === 'default' ? 'Default (main, system, crash)' : b,
      checked: settings.buffer === b,
      action: () => {
        settings.buffer = b;
        saveSettings();
        for (const t of tabs) if (!t.file && t.device) t.restart();
      },
    })),
    '-',
    { label: 'Reset All Settings…', action: resetSettings },
  ]);
});

async function resetSettings() {
  const ok = await api.confirm({
    message: 'Reset all settings?',
    detail: 'Tabs, filters, package/process selections, favorites, filter history, display options and the mirror panel ' +
      'go back to their defaults. Logs on the device are not affected.',
    ok: 'Reset',
  });
  if (ok) applyReset();
}

// Drop the saved settings and reload; reloading also stops every logcat stream and mirror session.
function applyReset() {
  resetting = true;
  clearTimeout(saveTimer);
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* storage unavailable */ }
  location.reload();
}
api.onMenu('resetSettings', resetSettings);

els.mirror.addEventListener('click', () => {
  MirrorView.setOpen(!MirrorView.isOpen());
  settings.mirror = MirrorView.isOpen();
  saveSettings();
  syncMirror();
});

els.shot.addEventListener('click', async () => {
  const t = active;
  if (!t.device) return;
  try {
    const saved = await api.screenshot(t.device);
    if (saved) toast('Screenshot saved to ' + saved);
  } catch (e) {
    toast('Screenshot failed: ' + e.message);
  }
});

// ---------- keyboard ----------

document.addEventListener('keydown', ev => {
  const inField = ev.target.matches('input, textarea, select');
  const mod = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  if (mod && k === 'f') {
    ev.preventDefault();
    els.query.focus();
    els.query.select();
  } else if (ev.key === 'Escape') {
    if (menuEl) closeMenu();
    else if (inField) ev.target.blur();
    else { active.selected.clear(); active.anchorId = null; queueRender(); }
  } else if (inField) {
    // leave text editing alone
  } else if (mod && k === 'c' && active.selected.size && !String(window.getSelection())) {
    ev.preventDefault();
    copySelection();
  } else if (mod && k === 'a') {
    ev.preventDefault();
    selectAll();
  } else if (ev.key === 'End') {
    ev.preventDefault();
    scrollToEnd();
  } else if (ev.key === 'Home') {
    ev.preventDefault();
    active.follow = false;
    els.log.scrollTop = 0;
  } else if (ev.key === ' ') {
    ev.preventDefault();
    active.setPaused(!active.paused);
  }
});

// ---------- boot ----------

applyFormat();
MirrorView.init({
  width: settings.mirrorWidth,
  onResize: w => { settings.mirrorWidth = Math.round(w); saveSettings(); },
  onClose: () => { settings.mirror = false; saveSettings(); syncMirror(); },
});
if (settings.mirror) MirrorView.setOpen(true);
tabs = settings.tabs.map(o => new Tab(o));
activateTab(tabs[Math.min(settings.active, tabs.length - 1)]);
refreshDevices().then(() => {
  for (const t of tabs) if (t.device && !t.streamId && !t.file) t.connect();
  refreshProcs();
  renderToolbar();
});
setInterval(() => { refreshDevices().then(renderToolbar); }, 2000);
setInterval(refreshProcs, 3000);
