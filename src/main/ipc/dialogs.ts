// Native dialogs, parented to the window that asked.

import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';

const windowOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined;

export async function showSave(e: IpcMainInvokeEvent, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = windowOf(e);
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return canceled || !filePath ? null : filePath;
}

export async function showOpen(e: IpcMainInvokeEvent, options: Electron.OpenDialogOptions): Promise<string | null> {
  const win = windowOf(e);
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return canceled || !filePaths.length ? null : filePaths[0];
}

export async function showMessage(e: IpcMainInvokeEvent, options: Electron.MessageBoxOptions): Promise<number> {
  const win = windowOf(e);
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response;
}
