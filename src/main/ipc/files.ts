// Log export/import and confirmation prompts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcMain } from 'electron';
import { IPC } from '../../shared/channels';
import type { ConfirmOptions, ImportedLog } from '../../shared/types';
import { parseLine } from '../adb/logcat';
import { showMessage, showOpen, showSave } from './dialogs';

const ALL_FILES = { name: 'All files', extensions: ['*'] };

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.saveFile, async (e, defaultName: string, text: string) => {
    const filePath = await showSave(e, {
      defaultPath: defaultName,
      filters: [{ name: 'Log files', extensions: ['txt', 'log'] }, ALL_FILES],
    });
    if (filePath) await fs.writeFile(filePath, text, 'utf8');
    return filePath;
  });

  ipcMain.handle(IPC.importFile, async (e): Promise<ImportedLog | null> => {
    const filePath = await showOpen(e, {
      properties: ['openFile'],
      filters: [{ name: 'Log files', extensions: ['txt', 'log', 'logcat'] }, ALL_FILES],
    });
    if (!filePath) return null;
    const text = await fs.readFile(filePath, 'utf8');
    return { name: path.basename(filePath), lines: text.split(/\r?\n/).map(parseLine) };
  });

  ipcMain.handle(IPC.confirm, async (e, { message, detail, ok }: ConfirmOptions) => {
    const response = await showMessage(e, {
      type: 'question',
      buttons: [ok || 'OK', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail,
    });
    return response === 0;
  });
}
