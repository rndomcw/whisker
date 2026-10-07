// App information, updates and links, for the About dialog.

import os from 'node:os';
import { app, ipcMain, shell } from 'electron';
import { IPC } from '../../shared/channels';
import type { AppInfo, AppLink } from '../../shared/types';
import { check, getUpdateStatus, installNow, openDownloadPage, REPO_URL } from '../updater';

const LINKS: Record<AppLink, string> = {
  repo: REPO_URL,
  issues: `${REPO_URL}/issues`,
  releases: `${REPO_URL}/releases`,
  license: `${REPO_URL}/blob/main/LICENSE`,
};

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
  }));
  ipcMain.handle(IPC.updateGetStatus, () => getUpdateStatus());
  ipcMain.on(IPC.updateCheck, () => void check());
  ipcMain.handle(IPC.updateInstall, () => installNow());
  // Only known links: a page could otherwise ask to open any URL.
  ipcMain.on(IPC.openLink, (_e, link: AppLink) => {
    if (link === 'releases' && getUpdateStatus().state === 'available') openDownloadPage();
    else if (LINKS[link]) void shell.openExternal(LINKS[link]);
  });
}
