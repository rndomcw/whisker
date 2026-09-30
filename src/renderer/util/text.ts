const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Escapes text for use in HTML content and attribute values. */
export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ESC[c]);

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Quotes a filter value when it contains spaces or query operators. */
export const quoteIfNeeded = (v: string) =>
  (/[\s()|&"\\]/.test(v) || v === '' ? `"${v.replace(/[\\"]/g, '\\$&')}"` : v);

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export { fileTimestamp } from '../../shared/time';

export function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Some SDKs color their logs with terminal escape codes ("\x1b[093m text \x1b[0m"); logcat shows them as junk.
const ANSI_RE = /\x1b?\[\d{1,3}(?:;\d{1,3})*m/g;

export function cleanMessage(msg: string): string {
  if (msg.includes('[')) msg = msg.replace(ANSI_RE, '');
  if (msg.includes('\t')) msg = msg.replace(/\t/g, '    ');
  return msg;
}

/**
 * A filter term for "lines like this one": the message up to its first number, so lines that only
 * differ in counters or ids (e.g. "fps 9.88") are hidden together.
 */
export function messageTerm(msg: string): string {
  let text = msg.trim();
  const num = text.search(/\d/);
  if (num > 8) text = text.slice(0, num);
  return text.slice(0, 60).trim();
}
