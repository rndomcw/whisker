// Device queries and logcat streams.

import { ipcMain, type IpcMainEvent, shell } from 'electron';
import { IPC } from '../../shared/channels';
import { ADB_DOWNLOAD_URL, ADB_NOT_FOUND, type DeviceList, type StreamOptions } from '../../shared/types';
import { chooseAdb } from '../adb/adb';
import { deviceInfo, listDevices, listProcesses, userPackages } from '../adb/devices';
import { clearLog, streamLogcat } from '../adb/logcat';
import { addStream, forgetStream, sessionKey, stopStream, watchSender } from '../sessions';
import { showOpen } from './dialogs';

export function registerAdbHandlers(): void {
  // A missing adb is an expected state, reported in the result rather than as an error.
  ipcMain.handle(IPC.devices, async (): Promise<DeviceList> => {
    try {
      return { devices: await listDevices(), adbMissing: false };
    } catch (err) {
      if ((err as Error).message === ADB_NOT_FOUND) return { devices: [], adbMissing: true };
      throw err;
    }
  });
  ipcMain.handle(IPC.locateAdb, async e => {
    const file = await showOpen(e, {
      title: 'Locate adb',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'adb', extensions: ['exe'] }] : [],
    });
    if (!file) return null;
    chooseAdb(file);
    return file;
  });
  ipcMain.on(IPC.openAdbDownload, () => void shell.openExternal(ADB_DOWNLOAD_URL));
  ipcMain.handle(IPC.deviceInfo, (_e, serial: string) => deviceInfo(serial));
  ipcMain.handle(IPC.procs, (_e, serial: string) => listProcesses(serial));
  ipcMain.handle(IPC.packages, (_e, serial: string) => userPackages(serial));
  ipcMain.handle(IPC.clear, (_e, serial: string, buffer: string) => clearLog(serial, buffer));

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
