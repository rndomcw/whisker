// IPC handlers behind the `window.whisker` API (see src/preload/preload.ts).

import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/channels';
import type { ConfirmOptions, ImportedLog, MirrorOptions, StreamOptions } from '../shared/types';
import { deviceInfo, listDevices, listProcesses, screenshot, userPackages } from './adb/devices';
import { clearLog, parseLine, streamLogcat } from './adb/logcat';
import { MirrorSession } from './mirror/mirrorSession';
import {
  addMirror, addStream, forgetMirror, forgetStream, getMirror, sessionKey, stopMirror, stopStream, watchSender,
} from './sessions';

const LOG_FILTERS = [{ name: 'Log files', extensions: ['txt', 'log'] }, { name: 'All files', extensions: ['*'] }];

const windowOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined;

const timestamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

async function showSave(e: IpcMainInvokeEvent, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = windowOf(e);
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return canceled || !filePath ? null : filePath;
}

function registerAdbHandlers(): void {
  ipcMain.handle(IPC.devices, () => listDevices());
  ipcMain.handle(IPC.deviceInfo, (_e, serial: string) => deviceInfo(serial));
  ipcMain.handle(IPC.procs, (_e, serial: string) => listProcesses(serial));
  ipcMain.handle(IPC.packages, (_e, serial: string) => userPackages(serial));
  ipcMain.handle(IPC.clear, (_e, serial: string, buffer: string) => clearLog(serial, buffer));
}

function registerLogcatHandlers(): void {
  ipcMain.on(IPC.logcatStart, (e: IpcMainEvent, id: number, opts: StreamOptions) => {
    const sender = e.sender;
    const key = sessionKey(sender, id);
    const send = (channel: string, ...args: unknown[]) => { if (!sender.isDestroyed()) sender.send(channel, ...args); };
    addStream(key, streamLogcat(
      opts,
      batch => send(IPC.logcatLines, id, batch),
      info => { forgetStream(key); send(IPC.logcatEnd, id, info); },
    ));
    watchSender(sender);
  });
  ipcMain.on(IPC.logcatStop, (e: IpcMainEvent, id: number) => stopStream(sessionKey(e.sender, id)));
}

function registerMirrorHandlers(): void {
  ipcMain.on(IPC.mirrorStart, (e: IpcMainEvent, id: number, serial: string, opts: MirrorOptions) => {
    const sender = e.sender;
    const key = sessionKey(sender, id);
    const session = new MirrorSession(serial, event => {
      if (event.type === 'end') forgetMirror(key);
      if (!sender.isDestroyed()) sender.send(IPC.mirrorEvent, id, event);
    });
    addMirror(key, session);
    watchSender(sender);
    void session.start(opts);
  });
  ipcMain.on(IPC.mirrorStop, (e: IpcMainEvent, id: number) => stopMirror(sessionKey(e.sender, id)));
  ipcMain.on(IPC.mirrorControl, (e: IpcMainEvent, id: number, data: Uint8Array) => {
    getMirror(sessionKey(e.sender, id))?.send(Buffer.from(data));
  });
}

function registerFileHandlers(): void {
  ipcMain.handle(IPC.saveFile, async (e, defaultName: string, text: string) => {
    const filePath = await showSave(e, { defaultPath: defaultName, filters: LOG_FILTERS });
    if (filePath) await fs.writeFile(filePath, text, 'utf8');
    return filePath;
  });

  ipcMain.handle(IPC.importFile, async (e): Promise<ImportedLog | null> => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Log files', extensions: ['txt', 'log', 'logcat'] }, { name: 'All files', extensions: ['*'] }],
    };
    const win = windowOf(e);
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (canceled || !filePaths.length) return null;
    const text = await fs.readFile(filePaths[0], 'utf8');
    return { name: path.basename(filePaths[0]), lines: text.split(/\r?\n/).map(parseLine) };
  });

  ipcMain.handle(IPC.screenshot, async (e, serial: string) => {
    const png = await screenshot(serial);
    const filePath = await showSave(e, {
      defaultPath: `screenshot-${serial.replace(/[^\w.-]/g, '_')}-${timestamp()}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (filePath) await fs.writeFile(filePath, png);
    return filePath;
  });

  ipcMain.handle(IPC.confirm, async (e, { message, detail, ok }: ConfirmOptions) => {
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: [ok || 'OK', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail,
    };
    const win = windowOf(e);
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return response === 0;
  });
}

export function registerIpc(): void {
  registerAdbHandlers();
  registerLogcatHandlers();
  registerMirrorHandlers();
  registerFileHandlers();
}
