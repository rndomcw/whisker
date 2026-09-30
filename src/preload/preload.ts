// Exposes the typed `window.whisker` API to the sandboxed renderer.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, menuChannel } from '../shared/channels';
import type { LogLine, MirrorEvent, RecordEvent, StreamEnd, WhiskerApi } from '../shared/types';

// Strip Electron's error prefix ("Error invoking remote method 'x': Error: ") so the UI shows adb's message.
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((err: Error) => {
    throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  });
}

const api: WhiskerApi = {
  platform: process.platform,
  devices: () => invoke(IPC.devices),
  deviceInfo: serial => invoke(IPC.deviceInfo, serial),
  procs: serial => invoke(IPC.procs, serial),
  packages: serial => invoke(IPC.packages, serial),
  clear: (serial, buffer) => invoke(IPC.clear, serial, buffer),
  start: (id, opts) => ipcRenderer.send(IPC.logcatStart, id, opts),
  stop: id => ipcRenderer.send(IPC.logcatStop, id),
  onLines: cb => { ipcRenderer.on(IPC.logcatLines, (_e, id: number, batch: LogLine[]) => cb(id, batch)); },
  onEnd: cb => { ipcRenderer.on(IPC.logcatEnd, (_e, id: number, info: StreamEnd) => cb(id, info)); },
  saveFile: (defaultName, text) => invoke(IPC.saveFile, defaultName, text),
  importFile: () => invoke(IPC.importFile),
  confirm: opts => invoke(IPC.confirm, opts),
  captureScreenshot: serial => invoke(IPC.captureScreenshot, serial),
  saveImage: (png, defaultName) => invoke(IPC.saveImage, png, defaultName),
  copyImage: png => invoke(IPC.copyImage, png),
  recordStart: (id, serial) => ipcRenderer.send(IPC.recordStart, id, serial),
  recordStop: id => invoke(IPC.recordStop, id),
  recordSave: (id, range, defaultName) => invoke(IPC.recordSave, id, range, defaultName),
  recordCopy: (id, range) => invoke(IPC.recordCopy, id, range),
  recordDiscard: id => ipcRenderer.send(IPC.recordDiscard, id),
  defaultCaptureFolder: () => invoke(IPC.defaultCaptureFolder),
  chooseFolder: current => invoke(IPC.chooseFolder, current),
  saveScreenshotTo: (serial, folder, baseName) => invoke(IPC.saveScreenshotTo, serial, folder, baseName),
  recordSaveTo: (id, folder, baseName) => invoke(IPC.recordSaveTo, id, folder, baseName),
  showInFolder: filePath => ipcRenderer.send(IPC.showInFolder, filePath),
  openFolder: folder => ipcRenderer.send(IPC.openFolder, folder),
  onRecord: cb => { ipcRenderer.on(IPC.recordEvent, (_e, id: number, event: RecordEvent) => cb(id, event)); },
  onMenu: (cmd, cb) => { ipcRenderer.on(menuChannel(cmd), () => cb()); },
  mirrorStart: (id, serial, opts) => ipcRenderer.send(IPC.mirrorStart, id, serial, opts),
  mirrorStop: id => ipcRenderer.send(IPC.mirrorStop, id),
  mirrorControl: (id, data) => ipcRenderer.send(IPC.mirrorControl, id, data),
  onMirror: cb => { ipcRenderer.on(IPC.mirrorEvent, (_e, id: number, event: MirrorEvent) => cb(id, event)); },
};

contextBridge.exposeInMainWorld('whisker', api);
