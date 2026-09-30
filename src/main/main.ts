// Electron main process entry point.

import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import { migrateSettings } from './migrate';
import { stopAll } from './sessions';
import { APP_ID, createWindow, followSystemTheme } from './window';

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
registerIpc();
followSystemTheme();

void app.whenReady().then(() => {
  migrateSettings();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  stopAll();
  if (process.platform !== 'darwin') app.quit();
});
