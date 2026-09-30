// The notice bar above the log (paused / reconnecting) and the empty-view message.

import { deviceOnline, devices } from '../devices';
import { els } from '../dom';
import { procPids } from '../log/processes';
import { state } from '../state';
import { firstIndexAtLeast } from '../util/search';

export function renderEmpty(): void {
  const t = state.active;
  let text = '';
  if (!t.file && !t.device) {
    text = devices.error ? `adb error: ${devices.error}` : 'No connected devices. Connect a device with USB debugging enabled.';
  } else if (!t.view.length && t.procSel.length && !t.file &&
             t.procSel.every(p => p.kind !== 'mine' && !procPids(t, p).length)) {
    const many = t.procSel.length > 1;
    const names = t.procSel.map(p => p.value).join(', ');
    text = `${names} ${many ? 'are' : 'is'} not running. Logs will appear here when ${many ? 'they start' : 'it starts'}.`;
  } else if (!t.view.length && t.entries.length && (!t.filter.empty || t.procSel.length)) {
    text = 'No log lines match the filter.';
  }
  els.empty.textContent = text;
  els.empty.hidden = !text;
}

export function renderNotice(): void {
  const t = state.active;
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
