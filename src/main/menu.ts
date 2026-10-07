// Application menu. On Windows/Linux the custom title bar hides the menu bar, so the Whisker logo in the
// header pops it up instead; it also provides the keyboard shortcuts.

import { BrowserWindow, ipcMain, Menu, shell, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { IPC, menuChannel } from '../shared/channels';
import type { MenuCommand, MenuState } from '../shared/types';
import { getUpdateStatus, installNow, isAutoCheck, REPO_URL, setAutoCheck, updateMenuLabel } from './updater';

const isMac = process.platform === 'darwin';

/** Settings the menu shows; they live in the renderer, which sends them whenever they change. */
let menuState: MenuState = { autoSave: false, captureFolder: '' };

const toRenderer = (cmd: MenuCommand) => (_item: unknown, win: BaseWindow | undefined) => {
  if (win && 'webContents' in win) (win as Electron.BrowserWindow).webContents.send(menuChannel(cmd));
};

export function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: toRenderer('newTab') },
        { label: 'Import Log…', accelerator: 'CmdOrCtrl+O', click: toRenderer('import') },
        { label: 'Export Log…', accelerator: 'CmdOrCtrl+S', click: toRenderer('save') },
        { type: 'separator' },
        { label: 'Reset All Settings…', click: toRenderer('resetSettings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // On Windows/Linux, copy/paste shortcuts work without an Edit menu; macOS needs one.
    ...(isMac ? [{ role: 'editMenu' } as const] : []),
    {
      label: 'Capture',
      submenu: [
        {
          label: 'Auto-save Captures (skip preview)', type: 'checkbox', checked: menuState.autoSave,
          click: toRenderer('toggleAutoSave'),
        },
        { type: 'separator' },
        { label: 'Auto-save Folder', enabled: false },
        { label: menuState.captureFolder || '(default)', enabled: false },
        { label: 'Change Auto-save Folder…', click: toRenderer('chooseCaptureFolder') },
        { label: 'Open Auto-save Folder', click: toRenderer('openCaptureFolder') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          // Shows the result in the About dialog; once an update is ready, installs it.
          label: updateMenuLabel(),
          click: (item, win) => {
            if (getUpdateStatus().state === 'ready' && installNow()) return;
            toRenderer('checkForUpdates')(item, win); // opens About, which starts the check
          },
        },
        {
          label: 'Automatically Check for Updates', type: 'checkbox', checked: isAutoCheck(),
          click: item => { setAutoCheck(item.checked); buildMenu(); },
        },
        { type: 'separator' },
        { label: 'Whisker on GitHub', click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report an Issue', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
        { type: 'separator' },
        { label: 'About Whisker', click: toRenderer('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function registerMenuHandlers(): void {
  ipcMain.on(IPC.appMenu, (e, x: number, y: number) => {
    const window = BrowserWindow.fromWebContents(e.sender);
    if (window) Menu.getApplicationMenu()?.popup({ window, x, y });
  });
  ipcMain.on(IPC.menuState, (_e, state: MenuState) => {
    if (state.autoSave === menuState.autoSave && state.captureFolder === menuState.captureFolder) return;
    menuState = state;
    buildMenu();
  });
}
