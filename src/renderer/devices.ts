// Connected devices and their processes, polled from adb.

import type { Device, DeviceInfo } from '../shared/types';
import { api } from './api';
import { newProcessTable, type ProcessTable } from './log/entry';
import { state } from './state';
import { renderDevice } from './ui/deviceSelector';
import { renderProc } from './ui/processSelector';
import { capitalize } from './util/text';
import { renderNotice } from './view/status';

export const devices = {
  list: [] as Device[],
  /** Device properties; null while being fetched. */
  info: new Map<string, DeviceInfo | null>(),
  tables: new Map<string, ProcessTable>(),
  /** Last adb error, e.g. adb not found. */
  error: '',
  /** The device list has been read at least once. */
  loaded: false,
};

/** Per-device process table, shared by all tabs on that device. */
export function devState(serial: string): ProcessTable {
  let d = devices.tables.get(serial);
  if (!d) {
    d = newProcessTable();
    devices.tables.set(serial, d);
  }
  return d;
}

export function deviceOnline(serial: string): boolean {
  return devices.list.some(d => d.serial === serial && d.state === 'device');
}

/** Label for the device picker, e.g. "Castles S1U2-M4 (serial)" + "Android 13, API 33". */
export function deviceText(serial: string): { main: string; sub: string } {
  const d = devices.list.find(x => x.serial === serial);
  const info = devices.info.get(serial);
  if (info?.model) {
    return {
      main: `${capitalize(info.manufacturer)} ${info.model} (${serial})`,
      sub: d ? (d.state === 'device' ? `Android ${info.release}, API ${info.sdk}` : d.state) : 'Disconnected',
    };
  }
  const model = d?.model ? d.model.replace(/_/g, '-') : '';
  return { main: model ? `${model} (${serial})` : serial, sub: d ? (d.state === 'device' ? '' : d.state) : 'Disconnected' };
}

/** Short name without the serial, e.g. "Castles S1U2-M4". */
export function deviceName(serial: string): string {
  const info = devices.info.get(serial);
  return info?.model ? `${capitalize(info.manufacturer)} ${info.model}` : serial;
}

export async function refreshDevices(): Promise<void> {
  let list: Device[];
  try {
    list = await api.devices();
    devices.error = '';
  } catch (e) {
    devices.error = (e as Error).message;
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
  for (const t of state.tabs) {
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

export async function refreshProcs(): Promise<void> {
  const serials = new Set(state.tabs.filter(t => !t.file && t.device).map(t => t.device));
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
      if (changed) for (const t of state.tabs) if (t.device === serial) t.onProcsChanged();
    } catch { /* device busy or gone; try again next tick */ }
  }
  if (state.hasActive) renderProc(); // pids change when the app restarts
}
