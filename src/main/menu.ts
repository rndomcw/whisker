// Application menu. The menu bar is hidden by the custom title bar; it still provides the shortcuts.

import { Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { menuChannel } from '../shared/channels';
import type { MenuCommand } from '../shared/types';

const isMac = process.platform === 'darwin';

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
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
