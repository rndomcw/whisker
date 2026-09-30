// Popup menus (dropdowns, context menus). One menu is open at a time.

export type MenuItem =
  | '-'
  | { header: string }
  | { node: HTMLElement }
  | {
      label: string;
      hint?: string;
      /** Shows a check column; true draws the check mark. */
      checked?: boolean;
      disabled?: boolean;
      action?: () => void;
      /** Adds a remove (×) button to the item. */
      remove?: () => void;
    };

let menuEl: HTMLElement | null = null;
let anchorEl: HTMLElement | null = null;

export function closeMenu(): void {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  anchorEl?.classList.remove('open');
  anchorEl = null;
}

/** Whether a menu is open (anchored to `anchor`, when given). */
export function isMenuOpen(anchor?: HTMLElement): boolean {
  return !!menuEl && (!anchor || anchorEl === anchor);
}

function div(className: string, text?: string): HTMLElement {
  const d = document.createElement('div');
  d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function showMenu(x: number, y: number, items: MenuItem[], cls = ''): HTMLElement {
  closeMenu();
  const m = div('menu ' + cls);
  const checks = items.some(it => typeof it === 'object' && 'label' in it && it.checked !== undefined);
  for (const it of items) {
    if (it === '-') { m.appendChild(div('sep')); continue; }
    if ('header' in it) { m.appendChild(div('menu-header', it.header)); continue; }
    if ('node' in it) { m.appendChild(it.node); continue; }
    const item = div('item' + (it.disabled ? ' disabled' : ''));
    item.innerHTML = (checks ? `<span class="check">${it.checked ? '<svg><use href="#i-check"/></svg>' : ''}</span>` : '') +
      '<span class="label"></span>' + (it.hint ? '<span class="hint"></span>' : '') +
      (it.remove ? '<span class="remove" title="Remove"><svg><use href="#i-close"/></svg></span>' : '');
    item.querySelector('.label')!.textContent = it.label;
    if (it.hint) item.querySelector('.hint')!.textContent = it.hint;
    item.addEventListener('click', ev => {
      if (it.remove && (ev.target as Element).closest('.remove')) { closeMenu(); it.remove(); return; }
      closeMenu();
      it.action?.();
    });
    m.appendChild(item);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = (y + r.height > innerHeight - 4 ? Math.max(4, y - r.height) : y) + 'px';
  menuEl = m;
  return m;
}

/** Opens a dropdown under `anchor`, marking the anchor `.open` while it shows. */
export function menuBelow(anchor: HTMLElement, items: MenuItem[], cls = ''): HTMLElement {
  const r = anchor.getBoundingClientRect();
  const m = showMenu(r.left, r.bottom + 4, items, cls);
  anchorEl = anchor;
  anchor.classList.add('open');
  return m;
}

export function initMenus(): void {
  document.addEventListener('mousedown', ev => {
    const target = ev.target as Node;
    // Clicks on the anchor are left to its own handler, which toggles the menu.
    if (menuEl && !menuEl.contains(target) && !anchorEl?.contains(target)) closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);
}
