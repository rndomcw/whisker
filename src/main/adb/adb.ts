// Locating and running adb.
//
// adb is looked up when it's needed rather than once at startup, so installing Android Studio (or
// choosing adb.exe in the app) takes effect without restarting. A path chosen in the app is saved
// in the user data folder and tried first.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { ADB_NOT_FOUND } from '../../shared/types';

export { ADB_NOT_FOUND };

const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
const configFile = () => path.join(app.getPath('userData'), 'adb.json');

let chosen: string | null | undefined; // undefined = not read yet
let found: string | null = null;

function chosenPath(): string | null {
  if (chosen === undefined) {
    try {
      const p = (JSON.parse(fs.readFileSync(configFile(), 'utf8')) as { path?: unknown }).path;
      chosen = typeof p === 'string' ? p : null;
    } catch {
      chosen = null;
    }
  }
  return chosen;
}

function candidates(): string[] {
  const list: string[] = [];
  const own = chosenPath();
  if (own) list.push(own);
  if (process.env.ADB) list.push(process.env.ADB);
  for (const v of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const dir = process.env[v];
    if (dir) list.push(path.join(dir, 'platform-tools', exe));
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    list.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe));
  }
  if (process.platform === 'darwin') {
    list.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe));
  }
  list.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', exe));
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) list.push(path.join(dir.replace(/^"|"$/g, ''), exe));
  }
  return list;
}

/** The adb executable, or null if there isn't one. */
export function adbPath(): string | null {
  if (found && fs.existsSync(found)) return found;
  found = candidates().find(c => fs.existsSync(c)) ?? null;
  return found;
}

/** Like adbPath(), but throws ADB_NOT_FOUND. */
export function requireAdb(): string {
  const p = adbPath();
  if (!p) throw new Error(ADB_NOT_FOUND);
  return p;
}

/** Uses `file` as adb from now on (and on later launches). Throws if it isn't an adb executable. */
export function chooseAdb(file: string): void {
  if (path.basename(file).toLowerCase() !== exe || !fs.existsSync(file)) {
    throw new Error(`Please choose ${exe}, from Android SDK Platform-Tools.`);
  }
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ path: file }));
  chosen = file;
  found = null;
}

/** Runs adb and resolves with its stdout; rejects with stderr as the message. */
export function runAdb(args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const adb = adbPath();
    if (!adb) { reject(new Error(ADB_NOT_FOUND)); return; }
    execFile(adb, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

/** Like runAdb, for binary output. */
export function runAdbBinary(args: string[], timeout = 20000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const adb = adbPath();
    if (!adb) { reject(new Error(ADB_NOT_FOUND)); return; }
    execFile(adb, args, { encoding: 'buffer', timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim()));
        else resolve(stdout);
      });
  });
}
