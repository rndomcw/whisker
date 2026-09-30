// Hover highlight that follows the pointer position rather than CSS :hover, so it stays steady
// while rows are rebuilt for streaming logs.

import { els } from '../dom';
import { state } from '../state';
import { indexAtY, rowTop } from './layout';

let pointerY: number | null = null;

export function updateHover(): void {
  let id: string | null = null;
  if (pointerY !== null && state.hasActive && state.active.view.length) {
    const t = state.active;
    const y = pointerY - els.log.getBoundingClientRect().top + els.log.scrollTop;
    const i = indexAtY(t, y);
    if (y >= 0 && i >= 0 && i < t.view.length && y < rowTop(t, t.view.length)) id = String(t.view[i].id);
  }
  for (const row of els.rows.children) row.classList.toggle('hover', (row as HTMLElement).dataset.id === id);
}

export function initHover(): void {
  els.log.addEventListener('mousemove', ev => { pointerY = ev.clientY; updateHover(); });
  els.log.addEventListener('mouseleave', () => { pointerY = null; updateHover(); });
}
