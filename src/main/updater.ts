// Updates from GitHub Releases (electron-updater): checks at startup and every few hours, downloads in
// the background, verifies the download against the release's SHA-512, and offers to restart. An
// update that isn't installed right away is installed when the app quits.
//
// Only the installed app updates itself; the portable .exe can't replace itself, so it is told where
// to download the new version instead.

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { hasRecordings } from './sessions';

const RELEASES_URL = 'https://github.com/cwchuca-dev/whisker/releases/latest';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 4 * 60 * 60_000;
/** Restart is held back while a recording runs; ask again after this long. */
const RECORDING_RETRY_MS = 60_000;

const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
/** For testing: a folder URL with latest.yml and an installer, used instead of GitHub. */
const testFeed = process.env.WHISKER_UPDATE_FEED;

const prefsFile = () => path.join(app.getPath('userData'), 'updates.json');
let autoCheck = true;
/** Version downloaded and ready to install, if any. */
let ready: string | null = null;
let checking = false;
let onChanged: () => void = () => {};

function loadPrefs(): void {
  try {
    autoCheck = (JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as { autoCheck?: boolean }).autoCheck !== false;
  } catch { /* defaults */ }
}

export const isAutoCheck = () => autoCheck;

export function setAutoCheck(on: boolean): void {
  autoCheck = on;
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ autoCheck: on })); } catch { /* not saved */ }
  if (on) void check(false);
}

/** Updates can be installed: the packaged, installed app (or a test feed). */
const canUpdate = () => (app.isPackaged || !!testFeed) && !portable;

const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

async function message(options: Electron.MessageBoxOptions): Promise<number> {
  const win = parentWindow();
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response;
}

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
  // Silent, so the installer's wizard doesn't open; then start the new version.
  if (choice === 0 && !hasRecordings()) autoUpdater.quitAndInstall(true, true);
}

/** Checks for an update. `manual` reports the result (also "up to date" and errors) in a dialog. */
export async function check(manual: boolean): Promise<void> {
  if (manual && ready) { void offerRestart(ready); return; }
  if (portable) {
    if (manual) await checkPortable();
    return;
  }
  if (!canUpdate()) {
    if (manual) await message({ type: 'info', message: 'Updates are only available in the installed app.', buttons: ['OK'] });
    return;
  }
  if (checking) return;
  checking = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.isUpdateAvailable ? result.updateInfo : null;
    if (manual) {
      if (info) {
        await message({
          type: 'info',
          message: `Downloading Whisker ${info.version}…`,
          detail: 'You can keep working. Whisker asks to restart when the download is done.',
          buttons: ['OK'],
        });
      } else {
        await message({ type: 'info', message: 'Whisker is up to date.', detail: `Version ${app.getVersion()}`, buttons: ['OK'] });
      }
    }
  } catch (err) {
    if (manual) {
      await message({
        type: 'warning',
        message: 'Could not check for updates.',
        detail: (err as Error).message.split('\n')[0],
        buttons: ['OK'],
      });
    }
  } finally {
    checking = false;
  }
}

/** The portable app compares versions only, and links to the download page. */
async function checkPortable(): Promise<void> {
  try {
    const res = await fetch('https://api.github.com/repos/cwchuca-dev/whisker/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const latest = String((await res.json() as { tag_name?: string }).tag_name ?? '').replace(/^v/, '');
    if (!latest || !isNewer(latest, app.getVersion())) {
      await message({ type: 'info', message: 'Whisker is up to date.', detail: `Version ${app.getVersion()}`, buttons: ['OK'] });
      return;
    }
    const choice = await message({
      type: 'info',
      message: `Whisker ${latest} is available.`,
      detail: 'The portable version can\'t update itself. Download the new version, or use the installer to get automatic updates.',
      buttons: ['Open Download Page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) void shell.openExternal(RELEASES_URL);
  } catch (err) {
    await message({ type: 'warning', message: 'Could not check for updates.', detail: (err as Error).message, buttons: ['OK'] });
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

export function showAbout(): void {
  void message({
    type: 'info',
    title: 'About Whisker',
    message: `Whisker ${app.getVersion()}`,
    detail: `A desktop Android logcat viewer with screen mirroring.\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n` +
      'github.com/cwchuca-dev/whisker\n\nMIT License · Mirroring uses the scrcpy server (Apache-2.0).',
    buttons: ['OK', 'Open on GitHub'],
    cancelId: 0,
  }).then(choice => { if (choice === 1) void shell.openExternal('https://github.com/cwchuca-dev/whisker'); });
}

/** Sets up the updater; `changed` is called when the menu's update items change. */
export function initUpdater(changed: () => void): void {
  onChanged = changed;
  loadPrefs();
  if (!canUpdate()) {
    if (portable && autoCheck) setTimeout(() => void checkPortableQuietly(), FIRST_CHECK_MS);
    return;
  }
  if (testFeed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    ready = info.version;
    onChanged();
    void offerRestart(info.version);
  });
  autoUpdater.on('error', () => { /* reported by manual checks; automatic ones try again later */ });
  setTimeout(() => { if (autoCheck) void check(false); }, FIRST_CHECK_MS);
  setInterval(() => { if (autoCheck && !ready) void check(false); }, CHECK_EVERY_MS);
}

/** Automatic check for the portable app: only speaks up when there is a newer version. */
async function checkPortableQuietly(): Promise<void> {
  try {
    const res = await fetch('https://api.github.com/repos/cwchuca-dev/whisker/releases/latest');
    if (!res.ok) return;
    const latest = String((await res.json() as { tag_name?: string }).tag_name ?? '').replace(/^v/, '');
    if (latest && isNewer(latest, app.getVersion())) await checkPortable();
  } catch { /* offline */ }
}

/** Label for the menu item: "Restart to Update to 1.0.1" once an update is ready. */
export const updateMenuLabel = () => (ready ? `Restart to Install Whisker ${ready}…` : 'Check for Updates…');
