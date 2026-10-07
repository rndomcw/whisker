// Electron main process entry point.

import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { stopAll } from './sessions';
import { initUpdater } from './updater';
import { APP_ID, createWindow, followSystemTheme } from './window';

// One process per user. A second process would share the settings folder, and Chromium makes it wait
// for the first one's storage lock, so it took seconds to show anything. Launching Whisker again
// opens another window here instead, which is instant.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  registerIpc();
  followSystemTheme();

  void app.whenReady().then(() => {
    initUpdater(buildMenu);
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
    app.on('second-instance', () => {
      const win = createWindow(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]);
      win.once('ready-to-show', () => win.focus());
    });
  });
}

app.on('window-all-closed', () => {
  stopAll();
  if (process.platform !== 'darwin') app.quit();
});
