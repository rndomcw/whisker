'use strict';

// adb helpers: locating adb, listing devices/processes, and streaming logcat.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ADB = findAdb();

function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [];
  if (process.env.ADB) candidates.push(process.env.ADB);
  for (const v of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[v]) candidates.push(path.join(process.env[v], 'platform-tools', exe));
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe));
  }
  if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe));
  }
  candidates.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', exe));
  return candidates.find(c => fs.existsSync(c)) || exe; // fall back to PATH
}

function adb(args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

async function listDevices() {
  const out = await adb(['devices', '-l']);
  return out.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('*') && !l.startsWith('List of'))
    .map(l => {
      const [serial, state, ...rest] = l.split(/\s+/);
      const props = {};
      for (const kv of rest) {
        const i = kv.indexOf(':');
        if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return { serial, state, model: props.model || '', product: props.product || '' };
    });
}

// App processes run as a per-app Linux user: u0_a123 (or app_123 on very old Android).
const APP_USER_RE = /^(u\d+_a\d+|app_\d+)$/;

function parsePs(out) {
  const lines = out.split(/\r?\n/).filter(l => l.trim());
  const result = { procs: {}, apps: [] };
  if (!lines.length) return result;
  const header = lines[0].trim().split(/\s+/);
  const pidCol = header.indexOf('PID');
  const userCol = header.indexOf('USER');
  if (pidCol < 0) return result;
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    const pid = cols[pidCol];
    const name = cols[cols.length - 1];
    if (!/^\d+$/.test(pid) || !name) continue;
    result.procs[pid] = name;
    if (userCol >= 0 && APP_USER_RE.test(cols[userCol])) result.apps.push(pid);
  }
  return result;
}

// Returns { procs: { pid: name }, apps: [pids of app processes] }.
async function listProcesses(serial) {
  // Android 8+ (toybox) needs -A to see all processes; older toolbox ps lists all by default.
  let res = { procs: {}, apps: [] };
  try { res = parsePs(await adb(['-s', serial, 'shell', 'ps -A -o PID,USER,NAME'])); } catch { /* fall through */ }
  if (Object.keys(res.procs).length < 5) res = parsePs(await adb(['-s', serial, 'shell', 'ps']));
  return res;
}

async function deviceInfo(serial) {
  const out = await adb(['-s', serial, 'shell',
    'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk']);
  const [manufacturer = '', model = '', release = '', sdk = ''] = out.split(/\r?\n/).map(s => s.trim());
  return { manufacturer, model, release, sdk };
}

// Installed third-party packages; used for Android Studio's `package:mine`.
async function userPackages(serial) {
  const out = await adb(['-s', serial, 'shell', 'pm list packages -3']);
  return out.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('package:')).map(l => l.slice(8));
}

function screenshot(serial) {
  return new Promise((resolve, reject) => {
    execFile(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'],
      { encoding: 'buffer', timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve(stdout);
      });
  });
}

function clearLog(serial, buffer) {
  const args = ['-s', serial, 'logcat'];
  if (buffer && buffer !== 'default') args.push('-b', buffer);
  return adb([...args, '-c']);
}

// threadtime: "09-30 12:34:56.789  1234  5678 D Tag     : message" (optionally with a "2026-" year prefix)
const LINE_RE = /^(?:(\d{4})-)?(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+(.*?)\s*:(?: (.*))?$/;

// logcat's threadtime format has no year; pick the one that puts the date nearest to today.
function inferYear(mmdd) {
  const now = new Date();
  const month = Number(mmdd.slice(0, 2));
  const diff = month - (now.getMonth() + 1);
  return now.getFullYear() + (diff > 6 ? -1 : diff < -6 ? 1 : 0);
}

function parseLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return line; // unparsed lines (e.g. "--------- beginning of main") stay raw strings
  // [date (YYYY-MM-DD), time, pid, tid, level, tag, msg]
  return [`${m[1] || inferYear(m[2])}-${m[2]}`, m[3], m[4], m[5], m[6], m[7], m[8] || ''];
}

// Streams parsed logcat lines in batches. Returns a function that stops the stream.
function streamLogcat({ serial, buffer, since, tail }, onLines, onEnd) {
  const args = ['-s', serial, 'logcat', '-v', 'threadtime'];
  if (buffer && buffer !== 'default') args.push('-b', buffer);
  // -T keeps streaming (unlike -t). Resume from a timestamp after a reconnect, else show recent history.
  args.push('-T', since || String(Number(tail) || 5000));

  const child = spawn(ADB, args, { windowsHide: true });
  let partial = '';
  let pending = [];
  let stderr = '';
  let done = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    const parts = (partial + chunk).split('\n');
    partial = parts.pop();
    for (const p of parts) pending.push(parseLine(p.replace(/\r+$/, '')));
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { stderr += d; });

  const flush = () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    onLines(batch);
  };
  const flushTimer = setInterval(flush, 50);

  const finish = info => {
    if (done) return;
    done = true;
    clearInterval(flushTimer);
    if (info) {
      if (partial) pending.push(parseLine(partial.replace(/\r+$/, '')));
      flush();
      onEnd(info);
    }
  };

  child.on('error', err => finish({ error: `failed to run adb (${ADB}): ${err.message}` }));
  child.on('close', code => finish({ code, error: stderr.trim() || `logcat exited (code ${code})` }));

  return () => {
    finish(null);
    child.kill();
  };
}

module.exports = {
  ADB, adb, listDevices, listProcesses, deviceInfo, userPackages, screenshot, clearLog, parseLine, streamLogcat,
};
