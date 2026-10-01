// Connected devices and their processes, polled from adb.

import { createSignal } from 'solid-js';
import { createMutable } from 'solid-js/store';
import type { Device, DeviceInfo } from '../../shared/types';
import { api } from '../api';
import { newProcessTable, type ProcessTable } from '../log/entry';
import { capitalize } from '../util/text';
import { state } from './app';

export const devices = createMutable({
  list: [] as Device[],
  /** Device properties by serial; null while being fetched. */
  info: {} as Record<string, DeviceInfo | null>,
  /** Last adb error. */
  error: '',
  /** adb isn't installed or wasn't found. */
  adbMissing: false,
  /** The device list has been read at least once. */
  loaded: false,
});

/**
 * Process tables are plain objects (filters read them for every line); `procsChanged` tells the UI
 * that one of them was updated.
 */
const tables = new Map<string, ProcessTable>();
const [procsTick, setProcsTick] = createSignal(0);

/** Read in components that show process information, so they update when it changes. */
export const procsChanged = procsTick;
export const markProcsChanged = () => setProcsTick(n => n + 1);

/** Per-device process table, shared by all tabs on that device. */
export function devState(serial: string): ProcessTable {
  let d = tables.get(serial);
  if (!d) {
    d = newProcessTable();
    tables.set(serial, d);
  }
  return d;
}

export function deviceOnline(serial: string): boolean {
  return devices.list.some(d => d.serial === serial && d.state === 'device');
}

/** Label for the device picker, e.g. "Castles S1U2-M4 (serial)" + "Android 13, API 33". */
export function deviceText(serial: string): { main: string; sub: string } {
  const d = devices.list.find(x => x.serial === serial);
  const info = devices.info[serial];
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
  const info = devices.info[serial];
  return info?.model ? `${capitalize(info.manufacturer)} ${info.model}` : serial;
}

export async function refreshDevices(): Promise<void> {
  let list: Device[];
  try {
    const res = await api.devices();
    list = res.devices;
    devices.adbMissing = res.adbMissing;
    devices.error = '';
  } catch (e) {
    devices.error = (e as Error).message;
    list = [];
  }
  // Only replace the list when it changed, so components reading it don't update every poll.
  if (JSON.stringify(list) !== JSON.stringify(devices.list)) devices.list = list;
  for (const d of list) {
    if (d.state === 'device' && !(d.serial in devices.info)) {
      devices.info[d.serial] = null;
      api.deviceInfo(d.serial)
        .then(info => { devices.info[d.serial] = info; })
        .catch(() => { delete devices.info[d.serial]; });
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
  markProcsChanged(); // pids change when an app restarts
}
