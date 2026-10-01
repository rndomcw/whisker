// Renderer entry point: restores the tabs, renders the UI and starts polling devices.

import './styles/index.css';
import { render } from 'solid-js/web';
import { api } from './api';
import { App } from './components/App';
import { exportLog, importLog, resetSettings } from './components/Toolbar';
import { state } from './state/app';
import { initCaptureSettings } from './state/capture';
import { devices, refreshDevices, refreshProcs } from './state/devices';
import { initRecorder } from './state/recorder';
import { setQuery } from './state/query';
import { settings } from './state/settings';
import { initStreamRouting } from './state/streams';
import { Tab } from './state/Tab';
import { activateTab, addTab, closeTab, newTabForActiveDevice } from './state/tabActions';

const DEVICE_POLL_MS = 2000;
const PROCESS_POLL_MS = 3000;

document.body.classList.add(api.platform === 'win32' ? 'win' : api.platform);

initStreamRouting();
initRecorder();
api.onMenu('newTab', newTabForActiveDevice);
api.onMenu('import', () => void importLog());
api.onMenu('save', () => void exportLog());
api.onMenu('resetSettings', () => void resetSettings());

state.tabs = settings.tabs.map(o => new Tab(o));
activateTab(state.tabs[Math.min(settings.active, state.tabs.length - 1)]);

render(() => {
  initCaptureSettings();
  return <App />;
}, document.getElementById('root')!);

void refreshDevices().then(() => {
  for (const t of state.tabs) if (t.device && !t.streamId && !t.file) t.connect();
  void refreshProcs();
});
setInterval(() => { void refreshDevices(); }, DEVICE_POLL_MS);
setInterval(() => { void refreshProcs(); }, PROCESS_POLL_MS);

// Handle for poking at the app from DevTools (and automated checks).
Object.assign(window, { __whisker: { state, settings, devices, setQuery, addTab, closeTab } });
