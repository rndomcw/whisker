// The device dropdown in the filter bar.

import { state } from '../../state/app';
import { deviceOnline, devices, deviceText } from '../../state/devices';
import { type MenuItem, toggleMenuBelow } from '../../state/menu';
import { Icon } from '../Icon';

function label(): { main: string; sub: string } {
  const t = state.active;
  if (t.file) return { main: t.file, sub: 'Imported file' };
  if (t.device) return deviceText(t.device);
  return { main: devices.list.length ? 'Select a device' : 'No connected devices', sub: '' };
}

function items(): MenuItem[] {
  const t = state.active;
  if (t.file) return [{ label: t.file, hint: 'Imported file', checked: true, disabled: true }];
  const serials = devices.list.map(d => d.serial);
  if (t.device && !serials.includes(t.device)) serials.push(t.device);
  const list: MenuItem[] = serials.map(serial => {
    const { main, sub } = deviceText(serial);
    return {
      label: main,
      hint: sub,
      checked: serial === t.device,
      disabled: !deviceOnline(serial) && serial !== t.device,
      action: () => t.setDevice(serial),
    };
  });
  if (!list.length) {
    list.push({
      label: devices.adbMissing ? 'adb not found' : devices.error ? `adb error: ${devices.error}` : 'No connected devices',
      disabled: true,
    });
  }
  return list;
}

export function DeviceSelector() {
  return (
    <button
      class="device-btn"
      title={label().sub ? `${label().main} ${label().sub}` : label().main}
      onClick={ev => toggleMenuBelow(ev.currentTarget, items)}
    >
      <Icon name={state.active.file ? 'file' : 'phone'} class="device-icon" />
      <span class="device-label">{label().main}</span>
      <span class="device-sub">{label().sub}</span>
      <Icon name="chevron" class="chevron" />
    </button>
  );
}
