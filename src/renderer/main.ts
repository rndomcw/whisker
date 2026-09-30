// Renderer entry point: wires up the UI modules and starts polling devices.

import './styles/index.css';
import { api } from './api';
import { devices, refreshDevices, refreshProcs } from './devices';
import { initMirrorPanel, setMirrorOpen } from './mirror/mirrorPanel';
import { saveSettings, settings } from './settings';
import { state } from './state';
import { Tab } from './tabs/Tab';
import { activateTab, addTab, closeTab, initTabStrip } from './tabs/tabStrip';
import { initStreamRouting } from './tabs/streams';
import { initDeviceSelector } from './ui/deviceSelector';
import { applyFormat } from './ui/formatMenu';
import { initKeyboard } from './ui/keyboard';
import { initLogView } from './ui/logView';
import { initMenus } from './ui/menu';
import { initProcessSelector } from './ui/processSelector';
import { initQueryBar, setQuery } from './ui/queryBar';
import { initToolbar, renderToolbar, syncMirror } from './ui/toolbar';
import { initHover } from './view/hover';

const DEVICE_POLL_MS = 2000;
const PROCESS_POLL_MS = 3000;

document.body.classList.add(api.platform === 'win32' ? 'win' : api.platform);

initMenus();
initStreamRouting();
initTabStrip();
initDeviceSelector();
initProcessSelector();
initQueryBar();
initLogView();
initHover();
initToolbar();
initKeyboard();
initMirrorPanel({
  width: settings.mirrorWidth,
  onResize: w => { settings.mirrorWidth = Math.round(w); saveSettings(); },
  onClose: () => { settings.mirror = false; saveSettings(); syncMirror(); },
});

applyFormat();
if (settings.mirror) setMirrorOpen(true);
state.tabs = settings.tabs.map(o => new Tab(o));
activateTab(state.tabs[Math.min(settings.active, state.tabs.length - 1)]);

void refreshDevices().then(() => {
  for (const t of state.tabs) if (t.device && !t.streamId && !t.file) t.connect();
  void refreshProcs();
  renderToolbar();
});
setInterval(() => { void refreshDevices().then(renderToolbar); }, DEVICE_POLL_MS);
setInterval(() => { void refreshProcs(); }, PROCESS_POLL_MS);

// Handle for poking at the app from DevTools (and automated checks).
Object.assign(window, { __whisker: { state, settings, devices, setQuery, addTab, closeTab } });
