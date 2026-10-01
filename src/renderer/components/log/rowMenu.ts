// The context menu for log lines: copy, filter or exclude by tag, message, package or process.

import { PKG_RE } from '../../constants';
import { type LogEntry, procOf } from '../../log/entry';
import { type ProcSel, sameProc } from '../../log/processes';
import { type MenuItem, showMenu } from '../../state/menu';
import { addQueryTerm } from '../../state/query';
import type { Tab } from '../../state/Tab';
import { messageTerm, quoteIfNeeded } from '../../util/text';
import { copySelection, copyText, selectAll, selectedEntries, selectOnly } from './actions';

export function showRowMenu(x: number, y: number, t: Tab, e: LogEntry): void {
  if (!t.selected.has(e.id)) selectOnly(t, e);
  const proc = procOf(t, e);
  const pkg = proc.split(':')[0];
  const items: MenuItem[] = [
    { label: 'Copy', hint: 'Ctrl+C', action: copySelection },
    {
      label: 'Copy Message',
      disabled: !!e.marker,
      action: () => void copyText(selectedEntries().filter(x => !x.marker).map(x => x.msg).join('\n')),
    },
  ];
  if (!e.marker && e.tag) {
    items.push('-',
      { label: `Filter tag: ${e.tag}`, action: () => addQueryTerm('tag:' + quoteIfNeeded(e.tag)) },
      { label: `Exclude tag: ${e.tag}`, action: () => addQueryTerm('-tag:' + quoteIfNeeded(e.tag)) });
    const text = messageTerm(e.msg);
    if (text) {
      items.push({
        label: `Exclude message: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`,
        action: () => addQueryTerm('-message:' + quoteIfNeeded(text)),
      });
    }
  }
  if (pkg) {
    const kind = PKG_RE.test(pkg) ? 'package' : 'process';
    const p: ProcSel = { kind, value: kind === 'package' ? pkg : proc };
    const selected = t.procSel.some(x => sameProc(x, p));
    items.push('-', { label: `Show only ${kind}: ${p.value}`, action: () => t.setProcSel([p]) });
    if (t.procSel.length && !selected) items.push({ label: `Add ${kind} to selection: ${p.value}`, action: () => t.toggleProc(p) });
    if (selected && t.procSel.length > 1) items.push({ label: `Remove ${kind} from selection: ${p.value}`, action: () => t.toggleProc(p) });
    items.push({ label: `Exclude ${kind}: ${p.value}`, action: () => addQueryTerm(`-${kind}:${quoteIfNeeded(p.value)}`) });
  }
  items.push('-', { label: 'Select All', hint: 'Ctrl+A', action: selectAll });
  showMenu(x, y, items);
}
