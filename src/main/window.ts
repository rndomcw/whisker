// The main window, drawn with a custom header like Android Studio's tool windows.

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';

const isMac = process.platform === 'darwin';

function overlayColors(): Electron.TitleBarOverlayOptions {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#2B2D30', symbolColor: '#DFE1E5', height: 36 }
    : { color: '#F7F8FA', symbolColor: '#1E1F22', height: 36 };
}

// Packaged builds take the icon from the .exe; this covers `npm start`.
function devIcon(): string | undefined {
  const file = path.join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fs.existsSync(file) ? file : undefined;
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 800,
    minHeight: 400,
    title: 'Whisker',
    icon: devIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E1F22' : '#FFFFFF',
    // Keep the native window buttons, but let the page draw the header.
    titleBarStyle: 'hidden',
    ...(isMac ? {} : { titleBarOverlay: overlayColors() }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

/** Keeps the window-button overlay in step with the OS light/dark theme. */
export function followSystemTheme(): void {
  nativeTheme.on('updated', () => {
    if (isMac) return;
    for (const win of BrowserWindow.getAllWindows()) win.setTitleBarOverlay(overlayColors());
  });
}
