// Device mirroring sessions.

import { ipcMain, type IpcMainEvent } from 'electron';
import { IPC } from '../../shared/channels';
import type { MirrorOptions } from '../../shared/types';
import { MirrorSession } from '../mirror/mirrorSession';
import { addMirror, forgetMirror, getMirror, sessionKey, stopMirror, watchSender } from '../sessions';

export function registerMirrorHandlers(): void {
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
