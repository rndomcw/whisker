import type { Tab } from './tabs/Tab';

/** The open tabs and the one shown in the window. */
class AppState {
  tabs: Tab[] = [];
  private current: Tab | null = null;

  get active(): Tab {
    if (!this.current) throw new Error('No active tab');
    return this.current;
  }

  set active(tab: Tab) {
    this.current = tab;
  }

  /** False only during startup, before the first tab is activated. */
  get hasActive(): boolean {
    return this.current !== null;
  }

  isActive(tab: Tab): boolean {
    return this.current === tab;
  }
}

export const state = new AppState();
