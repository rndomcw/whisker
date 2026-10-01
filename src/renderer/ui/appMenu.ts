// The ☰ button in the header: pops up the application menu (File, View), which the custom title bar
// hides on Windows/Linux. Pressing and releasing Alt on its own opens it too, like a native menu bar.

import { api } from '../api';
import { el } from '../dom';

export function initAppMenu(): void {
  if (api.platform === 'darwin') return;
  const btn = el<HTMLButtonElement>('appMenu');
  const open = () => {
    const r = btn.getBoundingClientRect();
    api.showAppMenu(r.left, r.bottom + 2);
  };
  btn.addEventListener('click', open);

  let altAlone = false;
  document.addEventListener('keydown', ev => { altAlone = ev.key === 'Alt' && !ev.repeat; }, true);
  document.addEventListener('mousedown', () => { altAlone = false; }, true);
  document.addEventListener('keyup', ev => {
    if (ev.key === 'Alt' && altAlone) { ev.preventDefault(); open(); }
    altAlone = false;
  }, true);
}
