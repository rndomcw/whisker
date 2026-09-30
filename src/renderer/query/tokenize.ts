export type Token =
  | { op: '(' | ')' | '|' | '&' }
  | { op?: undefined; word: string; literal: boolean };

const OPS = '()|&';

/** Splits a filter query into words (with "quoted" parts and \-escapes) and operators. */
export function tokenize(q: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const isBreak = (c: string) => /\s/.test(c) || OPS.includes(c);
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (OPS.includes(c)) { toks.push({ op: c as '(' | ')' | '|' | '&' }); i++; continue; }
    const start = i;
    let word = '';
    while (i < q.length && !isBreak(q[i])) {
      if (q[i] === '"') {
        i++;
        while (i < q.length && q[i] !== '"') {
          if (q[i] === '\\' && i + 1 < q.length) i++;
          word += q[i++];
        }
        i++;
      } else if (q[i] === '\\' && i + 1 < q.length) {
        word += q[i + 1];
        i += 2;
      } else {
        word += q[i++];
      }
    }
    // A quoted word is always free text, even if it looks like "tag:x".
    const literal = q[start] === '"' || (q[start] === '-' && q[start + 1] === '"');
    toks.push({ word, literal });
  }
  return toks;
}
