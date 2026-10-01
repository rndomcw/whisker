// Window-wide keyboard shortcuts. Text fields keep their own keys (the mirror panel stops propagation).

import { state } from '../state/app';
import { isDialogOpen } from '../state/dialog';
import { closeMenu, isMenuOpen } from '../state/menu';
import { focusQuery } from './filter/QueryBar';
import { closeFind, findStep, isFindOpen, openFind } from './log/FindBar';
import { clearSelection, copySelection, scrollToEnd, scrollToStart, selectAll } from './log/actions';

export function onKeyDown(ev: KeyboardEvent): void {
  if (isDialogOpen()) return; // an open dialog handles its own keys
  const target = ev.target as HTMLElement;
  const inField = target.matches?.('input, textarea, select') ?? false;
  const mod = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  if (mod && k === 'f') {
    ev.preventDefault();
    openFind();
  } else if (mod && k === 'l') {
    ev.preventDefault();
    focusQuery();
  } else if (ev.key === 'F3') {
    ev.preventDefault();
    findStep(ev.shiftKey ? -1 : 1);
  } else if (ev.key === 'Escape') {
    if (isMenuOpen()) closeMenu();
    else if (inField) target.blur();
    else if (state.active.selected.size) clearSelection();
    else if (isFindOpen()) closeFind();
  } else if (inField) {
    // leave text editing alone
  } else if (mod && k === 'c' && state.active.selected.size && !String(window.getSelection())) {
    ev.preventDefault();
    copySelection();
  } else if (mod && k === 'a') {
    ev.preventDefault();
    selectAll();
  } else if (ev.key === 'End') {
    ev.preventDefault();
    scrollToEnd();
  } else if (ev.key === 'Home') {
    ev.preventDefault();
    scrollToStart();
  } else if (ev.key === ' ') {
    ev.preventDefault();
    state.active.setPaused(!state.active.paused);
  }
}
