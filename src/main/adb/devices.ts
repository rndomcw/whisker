// Device-level adb queries: connected devices, device properties, processes, packages, screenshots.

import type { Device, DeviceInfo, ProcessList } from '../../shared/types';
import { runAdb, runAdbBinary } from './adb';

export async function listDevices(): Promise<Device[]> {
  const out = await runAdb(['devices', '-l']);
  return out.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('*') && !l.startsWith('List of'))
    .map(l => {
      const [serial = '', state = '', ...rest] = l.split(/\s+/);
      const props: Record<string, string> = {};
      for (const kv of rest) {
        const i = kv.indexOf(':');
        if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return { serial, state, model: props.model ?? '', product: props.product ?? '' };
    });
}

export async function deviceInfo(serial: string): Promise<DeviceInfo> {
  const out = await runAdb(['-s', serial, 'shell',
    'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk']);
  const [manufacturer = '', model = '', release = '', sdk = ''] = out.split(/\r?\n/).map(s => s.trim());
  return { manufacturer, model, release, sdk };
}

// App processes run as a per-app Linux user: u0_a123 (or app_123 on very old Android).
const APP_USER_RE = /^(u\d+_a\d+|app_\d+)$/;

export function parsePs(out: string): ProcessList {
  const lines = out.split(/\r?\n/).filter(l => l.trim());
  const result: ProcessList = { procs: {}, apps: [] };
  if (!lines.length) return result;
  const header = lines[0].trim().split(/\s+/);
  const pidCol = header.indexOf('PID');
  const userCol = header.indexOf('USER');
  if (pidCol < 0) return result;
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    const pid = cols[pidCol];
    const name = cols[cols.length - 1];
    if (!pid || !/^\d+$/.test(pid) || !name) continue;
    result.procs[pid] = name;
    if (userCol >= 0 && APP_USER_RE.test(cols[userCol] ?? '')) result.apps.push(pid);
  }
  return result;
}

export async function listProcesses(serial: string): Promise<ProcessList> {
  // Android 8+ (toybox) needs -A to see all processes; older toolbox ps lists all by default.
  let res: ProcessList = { procs: {}, apps: [] };
  try { res = parsePs(await runAdb(['-s', serial, 'shell', 'ps -A -o PID,USER,NAME'])); } catch { /* fall through */ }
  if (Object.keys(res.procs).length < 5) res = parsePs(await runAdb(['-s', serial, 'shell', 'ps']));
  return res;
}

/** Installed third-party packages; used for Android Studio's `package:mine`. */
export async function userPackages(serial: string): Promise<string[]> {
  const out = await runAdb(['-s', serial, 'shell', 'pm list packages -3']);
  return out.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('package:')).map(l => l.slice(8));
}

export function screenshot(serial: string): Promise<Buffer> {
  return runAdbBinary(['-s', serial, 'exec-out', 'screencap', '-p']);
}
