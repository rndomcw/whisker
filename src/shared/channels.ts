// IPC channel names shared by the main process and the preload bridge.

import type { MenuCommand } from './types';

export const IPC = {
  devices: 'adb:devices',
  locateAdb: 'adb:locate',
  openAdbDownload: 'adb:download',
  deviceInfo: 'adb:info',
  procs: 'adb:procs',
  packages: 'adb:packages',
  clear: 'adb:clear',
  logcatStart: 'logcat:start',
  logcatStop: 'logcat:stop',
  logcatLines: 'logcat:lines',
  logcatEnd: 'logcat:end',
  mirrorStart: 'mirror:start',
  mirrorStop: 'mirror:stop',
  mirrorControl: 'mirror:control',
  mirrorEvent: 'mirror:event',
  saveFile: 'file:save',
  importFile: 'file:import',
  confirm: 'app:confirm',
  captureScreenshot: 'capture:screenshot',
  saveImage: 'capture:saveImage',
  copyImage: 'capture:copyImage',
  recordStart: 'record:start',
  recordStop: 'record:stop',
  recordSave: 'record:save',
  recordCopy: 'record:copy',
  recordDiscard: 'record:discard',
  recordEvent: 'record:event',
  recordSaveTo: 'record:saveTo',
  defaultCaptureFolder: 'capture:defaultFolder',
  chooseFolder: 'capture:chooseFolder',
  saveScreenshotTo: 'capture:saveScreenshotTo',
  showInFolder: 'capture:showInFolder',
  openFolder: 'capture:openFolder',
  appMenu: 'app:menu',
  menuState: 'app:menuState',
} as const;

export const menuChannel = (cmd: MenuCommand) => `menu:${cmd}`;
