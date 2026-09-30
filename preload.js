'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Strip Electron's error prefix ("Error invoking remote method 'x': Error: ") so the UI shows adb's message.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch(err => {
  throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
});

contextBridge.exposeInMainWorld('logcat', {
  platform: process.platform,
  devices: () => invoke('adb:devices'),
  deviceInfo: serial => invoke('adb:info', serial),
  procs: serial => invoke('adb:procs', serial),
  packages: serial => invoke('adb:packages', serial),
  clear: (serial, buffer) => invoke('adb:clear', serial, buffer),
  start: (id, opts) => ipcRenderer.send('logcat:start', id, opts),
  stop: id => ipcRenderer.send('logcat:stop', id),
  onLines: cb => ipcRenderer.on('logcat:lines', (_e, id, batch) => cb(id, batch)),
  onEnd: cb => ipcRenderer.on('logcat:end', (_e, id, info) => cb(id, info)),
  saveFile: (defaultName, text) => invoke('file:save', defaultName, text),
  importFile: () => invoke('file:import'),
  screenshot: serial => invoke('device:screenshot', serial),
  confirm: opts => invoke('app:confirm', opts),
  onMenu: (name, cb) => ipcRenderer.on('menu:' + name, () => cb()),
  mirrorStart: (id, serial, opts) => ipcRenderer.send('mirror:start', id, serial, opts),
  mirrorStop: id => ipcRenderer.send('mirror:stop', id),
  mirrorControl: (id, data) => ipcRenderer.send('mirror:control', id, data),
  onMirror: cb => ipcRenderer.on('mirror:event', (_e, id, type, payload) => cb(id, type, payload)),
});
