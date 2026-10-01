// The notice bar above the log (paused / reconnecting) and the message shown when the view is empty.

import { procPids } from '../../log/processes';
import { state } from '../../state/app';
import { deviceOnline, devices, procsChanged } from '../../state/devices';
import { firstIndexAtLeast } from '../../util/search';

export function Notice() {
  const text = () => {
    const t = state.active;
    if (t.paused) {
      t.version;
      const waiting = t.entries.length - firstIndexAtLeast(t.entries, t.pausedAtId + 1);
      return `Logcat is paused${waiting ? ` · ${waiting.toLocaleString()} new lines` : ''}. Press Space or ▶ to resume.`;
    }
    if (!t.file && t.device && t.conn.state === 'reconnecting') {
      return deviceOnline(t.device)
        ? `Logcat stopped (${t.conn.msg}). Reconnecting…`
        : 'Device disconnected. Waiting for it to come back…';
    }
    return '';
  };
  return <div class="notice" hidden={!text()}>{text()}</div>;
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
  return <div class="empty" hidden={!text()}>{text()}</div>;
}
