// Screenshots and screen recordings.

import fs from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain, type IpcMainEvent, shell } from 'electron';
import { IPC } from '../../shared/channels';
import { fileTimestamp } from '../../shared/time';
import type { RecordingResult, TrimRange } from '../../shared/types';
import { screenshot } from '../adb/devices';
import { copyFile, copyImage } from '../capture/clipboard';
import { Recording } from '../capture/recording';
import { addRecording, discardRecording, getRecording, sessionKey, watchSender } from '../sessions';
import { showOpen, showSave } from './dialogs';

/**
 * Writes `folder/base.ext`, or `base-2.ext`, `base-3.ext`, … if taken (e.g. several screenshots in one
 * second). Files are created exclusively, so captures running at the same time never overwrite each other.
 */
async function writeUnique(folder: string, base: string, ext: string, data: Uint8Array): Promise<string> {
  await fs.mkdir(folder, { recursive: true });
  for (let n = 1; ; n++) {
    const file = path.join(folder, `${base}${n > 1 ? `-${n}` : ''}.${ext}`);
    try {
      await fs.writeFile(file, data, { flag: 'wx' });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

function recordingFor(e: { sender: Electron.WebContents }, id: number): Recording {
  const r = getRecording(sessionKey(e.sender, id));
  if (!r) throw new Error('The recording is no longer available');
  return r;
}

export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC.captureScreenshot, async (_e, serial: string) => new Uint8Array(await screenshot(serial)));

  ipcMain.handle(IPC.saveImage, async (e, png: Uint8Array, defaultName: string) => {
    const filePath = await showSave(e, { defaultPath: defaultName, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (filePath) await fs.writeFile(filePath, png);
    return filePath;
  });

  ipcMain.handle(IPC.copyImage, (_e, png: Uint8Array) => copyImage(png));

  ipcMain.on(IPC.recordStart, (e: IpcMainEvent, id: number, serial: string) => {
    const sender = e.sender;
    const recording = new Recording(serial, event => {
      if (!sender.isDestroyed()) sender.send(IPC.recordEvent, id, event);
    });
    addRecording(sessionKey(sender, id), recording);
    watchSender(sender);
    recording.start();
  });

  ipcMain.handle(IPC.recordStop, (e, id: number): RecordingResult | null => {
    const r = recordingFor(e, id);
    r.stop();
    if (!r.hasFrames) {
      discardRecording(sessionKey(e.sender, id));
      return null;
    }
    const { data, durationMs } = r.export(null);
    return { data: new Uint8Array(data), durationMs, ...r.size };
  });

  ipcMain.handle(IPC.recordSave, async (e, id: number, range: TrimRange | null, defaultName: string) => {
    const r = recordingFor(e, id);
    const filePath = await showSave(e, { defaultPath: defaultName, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (filePath) await fs.writeFile(filePath, r.export(range).data);
    return filePath;
  });

  ipcMain.handle(IPC.recordCopy, async (e, id: number, range: TrimRange | null) => {
    const r = recordingFor(e, id);
    const dir = path.join(app.getPath('temp'), 'Whisker');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `screenrecord-${fileTimestamp()}.mp4`);
    await fs.writeFile(file, r.export(range).data);
    await copyFile(file);
  });

  ipcMain.on(IPC.recordDiscard, (e: IpcMainEvent, id: number) => discardRecording(sessionKey(e.sender, id)));

  // ----- auto-save -----

  ipcMain.handle(IPC.defaultCaptureFolder, () => path.join(app.getPath('pictures'), 'Whisker'));

  ipcMain.handle(IPC.chooseFolder, (e, current: string) =>
    showOpen(e, { title: 'Auto-save folder', defaultPath: current, properties: ['openDirectory', 'createDirectory'] }));

  ipcMain.handle(IPC.saveScreenshotTo, async (_e, serial: string, folder: string, baseName: string) => {
    return writeUnique(folder, baseName, 'png', await screenshot(serial));
  });

  ipcMain.handle(IPC.recordSaveTo, async (e, id: number, folder: string, baseName: string) => {
    const r = recordingFor(e, id);
    r.stop();
    try {
      return await writeUnique(folder, baseName, 'mp4', r.export(null).data);
    } finally {
      discardRecording(sessionKey(e.sender, id));
    }
  });

  ipcMain.on(IPC.showInFolder, (_e, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.on(IPC.openFolder, (_e, folder: string) => {
    void fs.mkdir(folder, { recursive: true }).then(() => shell.openPath(folder));
  });
}
