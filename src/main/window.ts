// The main window, drawn with a custom header like Android Studio's tool windows.

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';

const isMac = process.platform === 'darwin';

/** Windows app id; matches `build.appId` in package.json so taskbar pins and installer shortcuts group together. */
export const APP_ID = 'com.whisker.logcat';

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

/** Opens a window; one opened next to an existing window is offset from it, so it doesn't hide it exactly. */
export function createWindow(near?: BrowserWindow | null): BrowserWindow {
  const at = near && !near.isDestroyed() && !near.isMinimized() && !near.isMaximized() ? near.getBounds() : null;
  const win = new BrowserWindow({
    width: at?.width ?? 1500,
    height: at?.height ?? 900,
    ...(at ? { x: at.x + 32, y: at.y + 32 } : {}),
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
  pinToPortableExe(win);
  return win;
}

/**
 * The portable .exe unpacks the app to a temp folder that is deleted on exit. Without this, pinning the
 * running window to the taskbar would point at that temp copy and break after the app closes.
 */
function pinToPortableExe(win: BrowserWindow): void {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE; // set by electron-builder's portable launcher
  if (process.platform !== 'win32' || !exe) return;
  win.setAppDetails({
    appId: APP_ID,
    relaunchCommand: `"${exe}"`,
    relaunchDisplayName: 'Whisker',
    appIconPath: exe,
    appIconIndex: 0,
  });
}

/** Keeps the window-button overlay in step with the OS light/dark theme. */
export function followSystemTheme(): void {
  nativeTheme.on('updated', () => {
    if (isMac) return;
    for (const win of BrowserWindow.getAllWindows()) win.setTitleBarOverlay(overlayColors());
  });
}
