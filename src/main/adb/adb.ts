// Locating and running adb.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ADB = findAdb();

function findAdb(): string {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates: string[] = [];
  if (process.env.ADB) candidates.push(process.env.ADB);
  for (const v of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const dir = process.env[v];
    if (dir) candidates.push(path.join(dir, 'platform-tools', exe));
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe));
  }
  if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe));
  }
  candidates.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', exe));
  return candidates.find(c => fs.existsSync(c)) ?? exe; // fall back to PATH
}

/** Runs adb and resolves with its stdout; rejects with stderr as the message. */
export function runAdb(args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

/** Like runAdb, for binary output. */
export function runAdbBinary(args: string[], timeout = 20000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { encoding: 'buffer', timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim()));
        else resolve(stdout);
      });
  });
}
