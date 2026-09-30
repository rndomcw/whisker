// Window-wide keyboard shortcuts. Text fields keep their own keys (the mirror panel stops propagation).

import { isDialogOpen } from '../capture/dialog';
import { els } from '../dom';
import { state } from '../state';
import { clearSelection, copySelection, scrollToEnd, scrollToStart, selectAll } from './logView';
import { closeMenu, isMenuOpen } from './menu';

export function initKeyboard(): void {
  document.addEventListener('keydown', ev => {
    if (isDialogOpen()) return; // an open dialog handles its own keys
    const target = ev.target as HTMLElement;
    const inField = target.matches('input, textarea, select');
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (mod && k === 'f') {
      ev.preventDefault();
      els.query.focus();
      els.query.select();
    } else if (ev.key === 'Escape') {
      if (isMenuOpen()) closeMenu();
      else if (inField) target.blur();
      else clearSelection();
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
  });
}
