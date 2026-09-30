'use strict';

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme } = require('electron');
const adb = require('./src/adb');
const { Mirror } = require('./src/mirror');

const streams = new Map(); // `${webContentsId}:${streamId}` -> stop function
const mirrors = new Map(); // `${webContentsId}:${mirrorId}` -> Mirror
const watched = new WeakSet(); // webContents we already clean up after
const isMac = process.platform === 'darwin';

function overlayColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#2B2D30', symbolColor: '#DFE1E5', height: 36 }
    : { color: '#F7F8FA', symbolColor: '#1E1F22', height: 36 };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 800,
    minHeight: 400,
    title: 'Whisker',
    // Packaged builds take the icon from the .exe; this covers `npm start`.
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E1F22' : '#FFFFFF',
    // Draw our own header like Android Studio's tool window; keep the native window buttons.
    titleBarStyle: 'hidden',
    ...(isMac ? {} : { titleBarOverlay: overlayColors() }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

nativeTheme.on('updated', () => {
  if (isMac) return;
  for (const win of BrowserWindow.getAllWindows()) win.setTitleBarOverlay(overlayColors());
});

function stopStream(key) {
  const stop = streams.get(key);
  if (stop) { stop(); streams.delete(key); }
}

function stopMirror(key) {
  const m = mirrors.get(key);
  if (m) { m.stop(); mirrors.delete(key); }
}

function stopAllFor(contentsId) {
  for (const key of [...streams.keys()]) if (key.startsWith(contentsId + ':')) stopStream(key);
  for (const key of [...mirrors.keys()]) if (key.startsWith(contentsId + ':')) stopMirror(key);
}

// A reload or closed window must not leave adb logcat or scrcpy processes running.
function watchSender(sender) {
  if (watched.has(sender)) return;
  watched.add(sender);
  const contentsId = sender.id;
  sender.on('destroyed', () => stopAllFor(contentsId));
  sender.on('did-navigate', () => stopAllFor(contentsId));
}

ipcMain.handle('adb:devices', () => adb.listDevices());
ipcMain.handle('adb:info', (_e, serial) => adb.deviceInfo(serial));
ipcMain.handle('adb:procs', (_e, serial) => adb.listProcesses(serial));
ipcMain.handle('adb:packages', (_e, serial) => adb.userPackages(serial));
ipcMain.handle('adb:clear', (_e, serial, buffer) => adb.clearLog(serial, buffer));

ipcMain.on('logcat:start', (e, id, opts) => {
  const sender = e.sender;
  const key = `${sender.id}:${id}`;
  stopStream(key);
  const send = (...args) => { if (!sender.isDestroyed()) sender.send(...args); };
  streams.set(key, adb.streamLogcat(
    opts,
    batch => send('logcat:lines', id, batch),
    info => { streams.delete(key); send('logcat:end', id, info); },
  ));
  watchSender(sender);
});
ipcMain.on('logcat:stop', (e, id) => stopStream(`${e.sender.id}:${id}`));

ipcMain.on('mirror:start', (e, id, serial, opts) => {
  const sender = e.sender;
  const key = `${sender.id}:${id}`;
  stopMirror(key);
  const mirror = new Mirror(serial, (type, payload) => {
    if (type === 'end') mirrors.delete(key);
    if (!sender.isDestroyed()) sender.send('mirror:event', id, type, payload);
  });
  mirrors.set(key, mirror);
  watchSender(sender);
  mirror.start(opts);
});
ipcMain.on('mirror:stop', (e, id) => stopMirror(`${e.sender.id}:${id}`));
ipcMain.on('mirror:control', (e, id, data) => {
  const m = mirrors.get(`${e.sender.id}:${id}`);
  if (m) m.send(Buffer.from(data));
});

ipcMain.handle('file:save', async (e, defaultName, text) => {
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: defaultName,
    filters: [{ name: 'Log files', extensions: ['txt', 'log'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, text, 'utf8');
  return filePath;
});

ipcMain.handle('app:confirm', async (e, { message, detail, ok }) => {
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'question',
    buttons: [ok || 'OK', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail,
  });
  return response === 0;
});

ipcMain.handle('file:import', async e => {
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile'],
    filters: [{ name: 'Log files', extensions: ['txt', 'log', 'logcat'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (canceled || !filePaths.length) return null;
  const text = await fs.readFile(filePaths[0], 'utf8');
  return { name: path.basename(filePaths[0]), lines: text.split(/\r?\n/).map(adb.parseLine) };
});

ipcMain.handle('device:screenshot', async (e, serial) => {
  const png = await adb.screenshot(serial);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: `screenshot-${serial.replace(/[^\w.-]/g, '_')}-${stamp}.png`,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, png);
  return filePath;
});

function buildMenu() {
  // The menu bar is hidden by the custom title bar; it still provides the keyboard shortcuts.
  const toRenderer = channel => (_item, win) => win && win.webContents.send(channel);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: toRenderer('menu:newTab') },
        { label: 'Import Log…', accelerator: 'CmdOrCtrl+O', click: toRenderer('menu:import') },
        { label: 'Export Log…', accelerator: 'CmdOrCtrl+S', click: toRenderer('menu:save') },
        { type: 'separator' },
        { label: 'Reset All Settings…', click: toRenderer('menu:resetSettings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // On Windows/Linux, copy/paste shortcuts work without an Edit menu; macOS needs one.
    ...(isMac ? [{ role: 'editMenu' }] : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]));
}

// The app used to be called "Logcat Viewer"; carry its saved settings over on the first Whisker launch.
function migrateSettings() {
  const dst = path.join(app.getPath('userData'), 'Local Storage');
  const src = path.join(app.getPath('appData'), 'Logcat Viewer', 'Local Storage');
  try {
    if (!fsSync.existsSync(dst) && fsSync.existsSync(src)) fsSync.cpSync(src, dst, { recursive: true });
  } catch { /* start with defaults */ }
}

app.whenReady().then(() => {
  migrateSettings();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const key of [...streams.keys()]) stopStream(key);
  for (const key of [...mirrors.keys()]) stopMirror(key);
  if (!isMac) app.quit();
});
