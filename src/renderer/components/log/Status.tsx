// The notice bar above the log (paused / reconnecting) and the message shown when the view is empty.

import { Show } from 'solid-js';
import { api } from '../../api';
import { procPids } from '../../log/processes';
import { state } from '../../state/app';
import { deviceOnline, devices, procsChanged, refreshDevices } from '../../state/devices';
import { toast } from '../../state/toast';
import { firstIndexAtLeast } from '../../util/search';

export function Notice() {
  const text = () => {
    const t = state.active;
    if (t.paused) {
      t.version;
      const waiting = t.entries.length - firstIndexAtLeast(t.entries, t.pausedAtId + 1);
      return `Logcat is paused${waiting ? ` · ${waiting.toLocaleString()} new lines` : ''}. Press Space or ▶ to resume.`;
    }
    if (!t.file && t.device && t.conn.state === 'reconnecting' && !devices.adbMissing) {
      return deviceOnline(t.device)
        ? `Logcat stopped (${t.conn.msg}). Reconnecting…`
        : 'Device disconnected. Waiting for it to come back…';
    }
    return '';
  };
  return <div class="notice" hidden={!text()}>{text()}</div>;
}

async function locateAdb(): Promise<void> {
  try {
    const file = await api.locateAdb();
    if (!file) return;
    toast('Using adb: ' + file);
    await refreshDevices();
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Shown instead of the log when adb can't be found: what it is, where to get it, or where it is. */
function AdbMissing() {
  const exe = api.platform === 'win32' ? 'adb.exe' : 'adb';
  return (
    <div class="empty">
      <div class="adb-missing">
        <div class="adb-missing-title">adb not found</div>
        <p>Whisker uses adb, from Google's Android SDK Platform-Tools, to read logs and mirror the device screen.</p>
        <div class="adb-missing-actions">
          <button class="dlg-btn primary" onClick={() => api.openAdbDownload()}>Download Platform-Tools</button>
          <button class="dlg-btn" onClick={() => void locateAdb()}>Locate {exe}…</button>
        </div>
        <p class="adb-missing-hint">
          Already installed? Locate {exe} in the platform-tools folder. Whisker also finds it in the Android Studio SDK
          and on your PATH, and checks again every few seconds.
        </p>
      </div>
    </div>
  );
}

export function EmptyState() {
  const text = () => {
    const t = state.active;
    t.version;
    procsChanged();
    if (!t.file && !t.device) {
      return devices.error ? `adb error: ${devices.error}` : 'No connected devices. Connect a device with USB debugging enabled.';
    }
    if (!t.view.length && t.procSel.length && !t.file && t.procSel.every(p => p.kind !== 'mine' && !procPids(t, p).length)) {
      const many = t.procSel.length > 1;
      const names = t.procSel.map(p => p.value).join(', ');
      return `${names} ${many ? 'are' : 'is'} not running. Logs will appear here when ${many ? 'they start' : 'it starts'}.`;
    }
    if (!t.view.length && t.entries.length && (!t.filter.empty || t.procSel.length)) return 'No log lines match the filter.';
    return '';
  };
  return (
    <Show when={!devices.adbMissing || state.active.file} fallback={<AdbMissing />}>
      <div class="empty" hidden={!text()}>{text()}</div>
    </Show>
  );
}
