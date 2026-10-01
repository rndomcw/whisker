// Opening, closing and switching tabs.

import { state } from './app';
import { refreshProcs } from './devices';
import { saveSettings } from './settings';
import { Tab, type TabOptions } from './Tab';

export function activateTab(t: Tab): void {
  state.active = t;
  saveSettings();
}

export function addTab(opts: TabOptions, activate = true): Tab {
  const t = new Tab(opts);
  state.tabs = [...state.tabs, t];
  if (activate) activateTab(t);
  if (!t.file && t.device) { t.connect(); void refreshProcs(); }
  saveSettings();
  return t;
}

export function closeTab(t: Tab): void {
  const i = state.tabs.indexOf(t);
  if (i < 0) return;
  t.dispose();
  state.tabs = state.tabs.filter(x => x !== t);
  if (!state.tabs.length) {
    addTab({ device: t.device });
    return;
  }
  if (state.isActive(t)) activateTab(state.tabs[Math.min(i, state.tabs.length - 1)]);
  saveSettings();
}

export function renameTab(t: Tab, name: string): void {
  if (!name.trim()) return;
  t.name = name.trim();
  saveSettings();
}

/** A new tab on the active tab's device (or no device, for an imported file). */
export function newTabForActiveDevice(): void {
  const t = state.active;
  addTab({ device: t.file ? '' : t.device });
}
