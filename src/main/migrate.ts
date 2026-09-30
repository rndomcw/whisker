import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** The app used to be called "Logcat Viewer"; carry its saved settings over on the first Whisker launch. */
export function migrateSettings(): void {
  const dst = path.join(app.getPath('userData'), 'Local Storage');
  const src = path.join(app.getPath('appData'), 'Logcat Viewer', 'Local Storage');
  try {
    if (!fs.existsSync(dst) && fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
  } catch { /* start with defaults */ }
}
