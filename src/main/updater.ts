// Updates from GitHub Releases (electron-updater): checks at startup and every few hours, downloads in
// the background, verifies the download against the release's SHA-512, and offers to restart. An
// update that isn't installed right away is installed when the app quits.
//
// Only the installed app updates itself; the portable .exe can't replace itself, so it is told where
// to download the new version instead.
//
// The state is shown in the About dialog (renderer), which gets it through IPC and status events.

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { IPC } from '../shared/channels';
import type { UpdateStatus } from '../shared/types';
import { hasRecordings } from './sessions';

export const REPO_URL = 'https://github.com/cwchuca-dev/whisker';
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const LATEST_API = 'https://api.github.com/repos/cwchuca-dev/whisker/releases/latest';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 4 * 60 * 60_000;
/** Restart is held back while a recording runs; ask again after this long. */
const RECORDING_RETRY_MS = 60_000;

const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
/** For testing: a folder URL with latest.yml and an installer, used instead of GitHub. */
const testFeed = process.env.WHISKER_UPDATE_FEED;

const prefsFile = () => path.join(app.getPath('userData'), 'updates.json');
let autoCheck = true;
let status: UpdateStatus = { state: 'idle' };
let onMenuChanged: () => void = () => {};

function loadPrefs(): void {
  try {
    autoCheck = (JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as { autoCheck?: boolean }).autoCheck !== false;
  } catch { /* defaults */ }
}

export const isAutoCheck = () => autoCheck;

export function setAutoCheck(on: boolean): void {
  autoCheck = on;
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ autoCheck: on })); } catch { /* not saved */ }
  if (on) void check();
}

/** Updates can be installed: the packaged, installed app (or a test feed). */
const canUpdate = () => (app.isPackaged || !!testFeed) && !portable;

export const getUpdateStatus = (): UpdateStatus => status;

/** Sets the status and tells every window (the About dialog shows it) and the menu. */
function setStatus(next: UpdateStatus): void {
  const wasReady = status.state === 'ready';
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(IPC.updateStatus, status);
  }
  if (wasReady !== (status.state === 'ready')) onMenuChanged();
}

const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

async function message(options: Electron.MessageBoxOptions): Promise<number> {
  const win = parentWindow();
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response;
}

/** Restarts into the downloaded update; false while a recording would be lost. */
export function installNow(): boolean {
  if (status.state !== 'ready' || hasRecordings()) return false;
  // Silent, so the installer's wizard doesn't open; then start the new version.
  autoUpdater.quitAndInstall(true, true);
  return true;
}

/** Asks to restart once an update has downloaded on its own. */
async function offerRestart(version: string): Promise<void> {
  if (hasRecordings()) {
    // Don't interrupt a recording, or one waiting in its preview to be saved.
    setTimeout(() => void offerRestart(version), RECORDING_RETRY_MS);
    return;
  }
  const choice = await message({
    type: 'info',
    title: 'Update ready',
    message: `Whisker ${version} is ready to install.`,
    detail: 'Restart now to update, or keep working; it will be installed when you quit Whisker.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 0) installNow();
}

/** Checks for an update; the result is reported through the status. */
export async function check(): Promise<void> {
  if (['checking', 'downloading', 'ready'].includes(status.state)) return;
  if (portable) { await checkPortable(); return; }
  if (!canUpdate()) { setStatus({ state: 'unsupported' }); return; }
  setStatus({ state: 'checking' });
  try {
    const result = await autoUpdater.checkForUpdates();
    // When there is an update, electron-updater downloads it and the events take over.
    if (!result?.isUpdateAvailable) setStatus({ state: 'current', checkedAt: Date.now() });
    else if (status.state === 'checking') setStatus({ state: 'downloading', version: result.updateInfo.version, percent: 0 });
  } catch (err) {
    setStatus({ state: 'error', error: (err as Error).message.split('\n')[0] });
  }
}

/** The portable app compares versions only, and links to the download page. */
async function checkPortable(): Promise<void> {
  setStatus({ state: 'checking' });
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const latest = String((await res.json() as { tag_name?: string }).tag_name ?? '').replace(/^v/, '');
    if (latest && isNewer(latest, app.getVersion())) setStatus({ state: 'available', version: latest });
    else setStatus({ state: 'current', checkedAt: Date.now() });
  } catch (err) {
    setStatus({ state: 'error', error: (err as Error).message });
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** Opens the release download page (for the portable app). */
export const openDownloadPage = () => void shell.openExternal(RELEASES_URL);

/** Sets up the updater; `menuChanged` is called when the menu's update item changes. */
export function initUpdater(menuChanged: () => void): void {
  onMenuChanged = menuChanged;
  loadPrefs();
  if (portable) {
    if (autoCheck) {
      setTimeout(() => {
        void checkPortable().then(async () => {
          if (status.state !== 'available') return;
          const choice = await message({
            type: 'info',
            message: `Whisker ${status.version} is available.`,
            detail: 'The portable version can\'t update itself. Download the new version, or use the installer to get automatic updates.',
            buttons: ['Open Download Page', 'Later'],
            defaultId: 0,
            cancelId: 1,
          });
          if (choice === 0) openDownloadPage();
        });
      }, FIRST_CHECK_MS);
    }
    return;
  }
  if (!canUpdate()) { status = { state: 'unsupported' }; return; }
  if (testFeed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (info: UpdateInfo) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', p => {
    if (status.state === 'downloading') setStatus({ ...status, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus({ state: 'ready', version: info.version });
    void offerRestart(info.version);
  });
  autoUpdater.on('error', err => {
    if (status.state === 'checking' || status.state === 'downloading') setStatus({ state: 'error', error: err.message.split('\n')[0] });
  });
  setTimeout(() => { if (autoCheck) void check(); }, FIRST_CHECK_MS);
  setInterval(() => { if (autoCheck) void check(); }, CHECK_EVERY_MS);
}

/** Label for the menu item, once an update is ready. */
export const updateMenuLabel = () =>
  (status.state === 'ready' ? `Restart to Install Whisker ${status.version}…` : 'Check for Updates…');
