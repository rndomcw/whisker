// IPC channel names shared by the main process and the preload bridge.

import type { MenuCommand } from './types';

export const IPC = {
  devices: 'adb:devices',
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
  screenshot: 'device:screenshot',
  confirm: 'app:confirm',
} as const;

export const menuChannel = (cmd: MenuCommand) => `menu:${cmd}`;
