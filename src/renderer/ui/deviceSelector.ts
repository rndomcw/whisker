// The device dropdown in the filter bar.

import { deviceOnline, devices, deviceText } from '../devices';
import { els } from '../dom';
import { state } from '../state';
import { isMenuOpen, closeMenu, type MenuItem, menuBelow } from './menu';
import { syncMirror } from './toolbar';

export function renderDevice(): void {
  if (!state.hasActive) return;
  const t = state.active;
  let main: string, sub: string;
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

function openDeviceMenu(): void {
  const t = state.active;
  const items: MenuItem[] = [];
  if (t.file) {
    items.push({ label: t.file, hint: 'Imported file', checked: true, disabled: true });
  } else {
    const serials = devices.list.map(d => d.serial);
    if (t.device && !serials.includes(t.device)) serials.push(t.device);
    for (const serial of serials) {
      const { main, sub } = deviceText(serial);
      items.push({
        label: main,
        hint: sub,
        checked: serial === t.device,
        disabled: !deviceOnline(serial) && serial !== t.device,
        action: () => t.setDevice(serial),
      });
    }
    if (!items.length) items.push({ label: devices.error ? `adb error: ${devices.error}` : 'No connected devices', disabled: true });
  }
  menuBelow(els.deviceBtn, items);
}

export function initDeviceSelector(): void {
  els.deviceBtn.addEventListener('click', () => {
    if (isMenuOpen(els.deviceBtn)) closeMenu();
    else openDeviceMenu();
  });
}
