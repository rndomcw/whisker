// User settings, persisted in localStorage between launches.

import { SETTINGS_KEY } from './constants';
import type { ProcSel } from './log/processes';
import { state } from './state';

export interface TabSettings {
  name: string;
  device: string;
  query: string;
  caseSens: boolean;
  procSel?: ProcSel[];
  /** Single-selection field from before multi-select; read for old settings only. */
  proc?: ProcSel;
}

export interface FormatSettings {
  date: boolean;
  pid: boolean;
  tag: boolean;
  pkg: boolean;
}

export interface Settings {
  tabs: TabSettings[];
  active: number;
  wrap: boolean;
  buffer: string;
  format: FormatSettings;
  favorites: string[];
  history: string[];
  mirror: boolean;
  mirrorWidth: number;
}

function defaults(): Settings {
  return {
    tabs: [{ name: 'Logcat', device: '', query: '', caseSens: false }],
    active: 0,
    wrap: false,
    buffer: 'default',
    format: { date: true, pid: true, tag: true, pkg: true },
    favorites: [],
    history: [],
    mirror: false,
    mirrorWidth: 380,
  };
}

function loadSettings(): Settings {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') as Partial<Settings> | null;
    if (s && Array.isArray(s.tabs) && s.tabs.length) return { ...d, ...s, format: { ...d.format, ...s.format } };
  } catch { /* storage unavailable */ }
  return d;
}

export const settings = loadSettings();

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let resetting = false;

/** Saves shortly after the last change; imported-file tabs are not remembered. */
export function saveSettings(): void {
  if (resetting) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const live = state.tabs.filter(t => !t.file);
    settings.tabs = live.map(t => ({ name: t.name, device: t.device, query: t.query, caseSens: t.caseSens, procSel: t.procSel }));
    settings.active = state.hasActive ? Math.max(0, live.indexOf(state.active)) : 0;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }, 200);
}

/** Drops the saved settings and reloads; reloading also stops every logcat stream and mirror session. */
export function resetAndReload(): void {
  resetting = true;
  clearTimeout(saveTimer);
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* storage unavailable */ }
  location.reload();
}
