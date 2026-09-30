// Putting captures on the system clipboard.

import { execFile } from 'node:child_process';
import { clipboard, ClipboardItem } from 'electron';

export async function copyImage(png: Uint8Array): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })]);
}

/**
 * Puts a file on the clipboard, so it can be pasted into Explorer, Teams, Slack, … Electron can't
 * write a file-drop list itself, so on Windows this uses PowerShell's Set-Clipboard.
 */
export async function copyFile(filePath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await clipboard.writeText(filePath);
    return;
  }
  const literal = `'${filePath.replace(/'/g, "''")}'`;
  await new Promise<void>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath ${literal}`],
      { windowsHide: true, timeout: 15000 },
      (err, _stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve()));
  });
}
