// The open tabs and the one shown in the window, as Solid signals.

import { createSignal } from 'solid-js';
import type { Tab } from './Tab';

const [tabs, setTabs] = createSignal<readonly Tab[]>([]);
const [current, setCurrent] = createSignal<Tab | null>(null);

export const state = {
  get tabs(): readonly Tab[] {
    return tabs();
  },
  set tabs(list: readonly Tab[]) {
    setTabs(list);
  },

  get active(): Tab {
    const t = current();
    if (!t) throw new Error('No active tab');
    return t;
  },
  set active(tab: Tab) {
    setCurrent(() => tab);
  },

  /** False only during startup, before the first tab is activated. */
  get hasActive(): boolean {
    return current() !== null;
  },

  isActive(tab: Tab): boolean {
    return current() === tab;
  },
};
