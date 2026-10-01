// Auto-save for screenshots and recordings: the setting, its folder, and the quick save paths.

import { createEffect, createSignal } from 'solid-js';
import { api } from '../api';
import { fileTimestamp } from '../util/text';
import { deviceName } from './devices';
import type { MenuItem } from './menu';
import { saveSettings, settings } from './settings';
import { toast } from './toast';

const [defaultFolder, setDefaultFolder] = createSignal('');

export const isAutoSave = () => settings.capture.autoSave;

export const captureFolder = () => settings.capture.folder || defaultFolder();

/** e.g. screenshot-Castles_S1U2-M4-2026-09-30-16-40-12 */
export function captureBaseName(kind: 'screenshot' | 'screenrecord', serial: string): string {
  return `${kind}-${deviceName(serial).replace(/[^\w.-]+/g, '_')}-${fileTimestamp()}`;
}

function savedToast(what: string, file: string): void {
  const name = file.split(/[\\/]/).pop() ?? file;
  toast(`${what} saved: ${name}`, { label: 'Show in Folder', run: () => api.showInFolder(file) });
}

export async function autoSaveScreenshot(serial: string): Promise<void> {
  try {
    savedToast('Screenshot', await api.saveScreenshotTo(serial, captureFolder(), captureBaseName('screenshot', serial)));
  } catch (e) {
    toast('Screenshot failed: ' + (e as Error).message);
  }
}

/** Saves a stopped recording; `note` explains why it stopped, if it wasn't the user. */
export async function autoSaveRecording(id: number, serial: string, note = ''): Promise<void> {
  try {
    const file = await api.recordSaveTo(id, captureFolder(), captureBaseName('screenrecord', serial));
    savedToast(note ? `${note}. Recording` : 'Recording', file);
  } catch (e) {
    toast('Saving the recording failed: ' + (e as Error).message);
  }
}

function setAutoSave(on: boolean): void {
  settings.capture.autoSave = on;
  saveSettings();
  toast(on ? `Auto-save on: captures go to ${captureFolder()}` : 'Auto-save off: captures open a preview');
}

async function chooseFolder(): Promise<void> {
  const folder = await api.chooseFolder(captureFolder());
  if (!folder) return;
  settings.capture.folder = folder;
  saveSettings();
  toast('Auto-save folder: ' + folder);
}

/** Menu items for the capture buttons' context menu (the application menu's Capture menu has the same). */
export function captureMenuItems(): MenuItem[] {
  return [
    { label: 'Auto-save Captures (skip preview)', checked: isAutoSave(), action: () => setAutoSave(!isAutoSave()) },
    { label: 'Choose Auto-save Folder…', hint: captureFolder(), action: () => void chooseFolder() },
    { label: 'Open Auto-save Folder', action: () => api.openFolder(captureFolder()) },
  ];
}

/** Handles the application menu's Capture items and keeps that menu in sync. Call inside a root. */
export function initCaptureSettings(): void {
  api.onMenu('toggleAutoSave', () => setAutoSave(!isAutoSave()));
  api.onMenu('chooseCaptureFolder', () => void chooseFolder());
  api.onMenu('openCaptureFolder', () => api.openFolder(captureFolder()));
  void api.defaultCaptureFolder().then(setDefaultFolder);
  createEffect(() => api.setMenuState({ autoSave: isAutoSave(), captureFolder: captureFolder() }));
}
