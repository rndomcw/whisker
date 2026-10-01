// Popup menus (dropdowns, context menus): what is open, rendered by components/Menu.tsx.
// One menu is open at a time.

import { createSignal, type JSX } from 'solid-js';

export type MenuItem =
  | '-'
  | { header: string }
  /** Custom content, such as the process picker or the query help. */
  | { content: () => JSX.Element }
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

export interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
  cls: string;
  /** The button the menu drops down from; it gets `.open`, and clicking it again closes the menu. */
  anchor: HTMLElement | null;
}

const [menu, setMenu] = createSignal<OpenMenu | null>(null);
export const openMenu = menu;

export function closeMenu(): void {
  setMenu(null);
}

/** Whether a menu is open (anchored to `anchor`, when given). */
export function isMenuOpen(anchor?: HTMLElement): boolean {
  const m = menu();
  return !!m && (!anchor || m.anchor === anchor);
}

export function showMenu(x: number, y: number, items: MenuItem[], cls = ''): void {
  setMenu({ x, y, items, cls, anchor: null });
}

/** Opens a dropdown under `anchor`, or closes it if it is already open there. */
export function toggleMenuBelow(anchor: HTMLElement, items: () => MenuItem[], cls = ''): void {
  if (isMenuOpen(anchor)) { closeMenu(); return; }
  const r = anchor.getBoundingClientRect();
  setMenu({ x: r.left, y: r.bottom + 4, items: items(), cls, anchor });
}
