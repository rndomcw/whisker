// Android Studio compatible filter queries: tag:, package:, process:, message:, line:, level:, age:, is:,
// with -key: exclusion, =: exact and ~: regex matching, free text, |, & and parentheses.

import { LEVEL_RANK, LEVEL_WORDS } from '../constants';
import { displayLine, entryTime, type HasProcessTable, type LogEntry, procOf } from '../log/entry';
import { escapeRe } from '../util/text';
import { type Token, tokenize } from './tokenize';

export type Predicate = (e: LogEntry, t: HasProcessTable) => boolean;

export interface CompiledFilter {
  test: Predicate;
  /** The query has no terms at all. */
  empty: boolean;
  /** First problem found (bad regex, unknown level, …), for the query box tooltip. */
  error: string;
  /** Highlights free-text and message matches in the view. */
  hl: RegExp | null;
  /** The result depends on process names, so it changes when pids are resolved. */
  usesProc: boolean;
}

export const QUERY_KEYS = ['tag', 'package', 'process', 'message', 'line', 'level', 'age', 'is'];
const TEXT_KEYS = new Set(['tag', 'package', 'process', 'message', 'line']);

const IS_TESTS: Record<string, Predicate> = {
  crash: e => e.lvl === 'A' || e.lvl === 'F' || (e.lvl === 'E' && e.tag === 'AndroidRuntime'),
  stacktrace: e => /^\s*(at\s|Caused by:|\.\.\.\s\d+\smore)/.test(e.msg),
};

const AGE_UNITS: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };

interface Term {
  key?: string;
  neg?: boolean;
  fn: Predicate;
}

export function compileQuery(query: string, caseSensitive: boolean): CompiledFilter {
  const errors: string[] = [];
  const highlights: string[] = [];
  let usesProc = false;
  const fold = (s: string) => (caseSensitive ? s : s.toLowerCase());

  function textMatcher(op: string, v: string): ((s: string) => boolean) | null {
    if (op === '~:') {
      try {
        const re = new RegExp(v, caseSensitive ? '' : 'i');
        return s => re.test(s);
      } catch (err) {
        errors.push((err as Error).message);
        return null;
      }
    }
    const needle = fold(v);
    return op === '=:' ? s => fold(s) === needle : s => fold(s).includes(needle);
  }

  // Process start/end markers only respond to package/process terms; raw lines only show unfiltered.
  function term(key: string, neg: boolean, fn: Predicate): Term {
    const procKey = key === 'package' || key === 'process';
    return {
      key,
      neg,
      fn: (e, t) => {
        if (e.marker && !procKey) return true;
        const r = fn(e, t);
        return neg ? !r : r;
      },
    };
  }

  function compileKeyTerm(key: string, neg: boolean, op: string, v: string): Term | null {
    if (!v) return null; // still being typed
    if (TEXT_KEYS.has(key)) {
      if (key === 'package' || key === 'process') usesProc = true;
      if (key === 'package' && op === ':' && v === 'mine') {
        return term(key, neg, (e, t) => t.ds.mine.has(procOf(t, e).split(':')[0]));
      }
      const match = textMatcher(op, v);
      if (!match) return null;
      const get: Record<string, (e: LogEntry, t: HasProcessTable) => string> = {
        tag: e => e.tag,
        message: e => e.msg,
        package: (e, t) => procOf(t, e).split(':')[0],
        process: (e, t) => procOf(t, e),
        line: (e, t) => displayLine(t, e),
      };
      if (key === 'message' && !neg) highlights.push(op === '~:' ? v : escapeRe(v));
      return term(key, neg, (e, t) => match(get[key](e, t)));
    }
    if (key === 'level') {
      const l = LEVEL_WORDS[v.toUpperCase()];
      if (!l) { errors.push(`Unknown level "${v}"`); return null; }
      const r = LEVEL_RANK[l];
      return term(key, neg, op === '=:' ? e => LEVEL_RANK[e.lvl] === r : e => LEVEL_RANK[e.lvl] >= r);
    }
    if (key === 'age') {
      const a = /^(\d+)([smhd])$/i.exec(v);
      if (!a) { errors.push(`Invalid age "${v}" (use 30s, 5m, 2h or 1d)`); return null; }
      const since = Date.now() - Number(a[1]) * AGE_UNITS[a[2].toLowerCase()];
      return term(key, neg, e => entryTime(e) >= since);
    }
    const test = IS_TESTS[v.toLowerCase()];
    if (!test) { errors.push(`Unknown "is:${v}"`); return null; }
    return term(key, neg, test);
  }

  function compileWord(tok: { word: string; literal: boolean }): Term | null {
    const m = tok.literal ? null : /^(-?)([a-z]+)(=:|~:|:)([\s\S]*)$/i.exec(tok.word);
    if (m && QUERY_KEYS.includes(m[2].toLowerCase())) return compileKeyTerm(m[2].toLowerCase(), !!m[1], m[3], m[4]);
    // Free text: matches tag, package or message.
    let w = tok.word, neg = false;
    if (w.length > 1 && w[0] === '-') { neg = true; w = w.slice(1); }
    if (!w) return null;
    usesProc = true;
    const match = textMatcher(':', w);
    if (!match) return null;
    if (!neg) highlights.push(escapeRe(w));
    return term('text', neg, (e, t) => match(e.msg) || match(e.tag) || match(procOf(t, e)));
  }

  const toks: Token[] = tokenize(query);
  let pos = 0;
  const peekOp = () => toks[pos]?.op;

  function parseOr(): Predicate {
    const parts = [parseAnd()];
    while (peekOp() === '|') { pos++; parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0] : (e, t) => parts.some(p => p(e, t));
  }

  function parseAnd(): Predicate {
    const items: Term[] = [];
    while (pos < toks.length && peekOp() !== '|' && peekOp() !== ')') {
      const tok = toks[pos++];
      if (tok.op === '&') continue;
      if (tok.op === '(') {
        const inner = parseOr();
        if (peekOp() === ')') pos++; else errors.push('Missing ")"');
        items.push({ fn: inner });
        continue;
      }
      if (tok.op) continue;
      const c = compileWord(tok);
      if (c) items.push(c);
    }
    // As in Android Studio, positive terms with the same key are OR-ed: tag:a tag:b → (tag:a | tag:b).
    const groups = new Map<string, Predicate[]>();
    const fns: Predicate[] = [];
    for (const it of items) {
      if (it.key && TEXT_KEYS.has(it.key) && !it.neg) {
        let g = groups.get(it.key);
        if (!g) {
          const group: Predicate[] = [];
          groups.set(it.key, group);
          fns.push((e, t) => group.some(f => f(e, t)));
          g = group;
        }
        g.push(it.fn);
      } else {
        fns.push(it.fn);
      }
    }
    if (!fns.length) return () => true;
    return fns.length === 1 ? fns[0] : (e, t) => fns.every(f => f(e, t));
  }

  const roots = [parseOr()];
  while (pos < toks.length) { pos++; errors.push('Unexpected ")"'); roots.push(parseOr()); }
  const root: Predicate = roots.length === 1 ? roots[0] : (e, t) => roots.every(r => r(e, t));
  const empty = !toks.length;

  let hl: RegExp | null = null;
  if (highlights.length) {
    try { hl = new RegExp(highlights.join('|'), caseSensitive ? 'g' : 'gi'); } catch { /* invalid user regex */ }
  }
  return {
    test: (e, t) => (e.raw ? empty : root(e, t)),
    empty,
    error: errors[0] || '',
    hl,
    usesProc,
  };
}
