// Exposes the typed `window.whisker` API to the sandboxed renderer.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, menuChannel } from '../shared/channels';
import type { LogLine, MirrorEvent, StreamEnd, WhiskerApi } from '../shared/types';

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
  screenshot: serial => invoke(IPC.screenshot, serial),
  confirm: opts => invoke(IPC.confirm, opts),
  onMenu: (cmd, cb) => { ipcRenderer.on(menuChannel(cmd), () => cb()); },
  mirrorStart: (id, serial, opts) => ipcRenderer.send(IPC.mirrorStart, id, serial, opts),
  mirrorStop: id => ipcRenderer.send(IPC.mirrorStop, id),
  mirrorControl: (id, data) => ipcRenderer.send(IPC.mirrorControl, id, data),
  onMirror: cb => { ipcRenderer.on(IPC.mirrorEvent, (_e, id: number, event: MirrorEvent) => cb(id, event)); },
};

contextBridge.exposeInMainWorld('whisker', api);
