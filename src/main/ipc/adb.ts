// Device queries and logcat streams.

import { ipcMain, type IpcMainEvent } from 'electron';
import { IPC } from '../../shared/channels';
import type { StreamOptions } from '../../shared/types';
import { deviceInfo, listDevices, listProcesses, userPackages } from '../adb/devices';
import { clearLog, streamLogcat } from '../adb/logcat';
import { addStream, forgetStream, sessionKey, stopStream, watchSender } from '../sessions';

export function registerAdbHandlers(): void {
  ipcMain.handle(IPC.devices, () => listDevices());
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
