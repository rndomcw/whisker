// IPC handlers behind the `window.whisker` API (see src/preload/preload.ts).

import { registerAdbHandlers } from './adb';
import { registerCaptureHandlers } from './capture';
import { registerFileHandlers } from './files';
import { registerMirrorHandlers } from './mirror';
import { registerMenuHandlers } from '../menu';

export function registerIpc(): void {
  registerAdbHandlers();
  registerMirrorHandlers();
  registerFileHandlers();
  registerCaptureHandlers();
  registerMenuHandlers();
}
