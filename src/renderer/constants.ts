/** Row height in px; keep in sync with --row-h in styles/theme.css. */
export const ROW_H = 20;

/** Lines kept per tab before the oldest are dropped. */
export const MAX_ENTRIES = 200000;

/** Recent lines to show when a stream starts. */
export const TAIL_LINES = 5000;

export const LEVEL_RANK: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5, A: 5 };

export const LEVEL_WORDS: Record<string, string> = {
  V: 'V', VERBOSE: 'V', D: 'D', DEBUG: 'D', I: 'I', INFO: 'I', W: 'W', WARN: 'W', WARNING: 'W',
  E: 'E', ERROR: 'E', A: 'A', ASSERT: 'A', F: 'A', FATAL: 'A',
};

/** Log column widths in ch. */
export const COLW = { date: 24, time: 13, pid: 13, tag: 24, pkg: 32, lvl: 3 } as const;

/** Number of tag color classes (.t0 … .t11 in styles/log.css). */
export const TAG_COLORS = 12;

export const BUFFERS = ['default', 'all', 'main', 'system', 'crash', 'events', 'radio'];

export const SETTINGS_KEY = 'logcat-settings-v2';

/** Looks like an Android package name (com.example.app). */
export const PKG_RE = /^[a-z][\w]*(\.[\w]+)+$/i;
