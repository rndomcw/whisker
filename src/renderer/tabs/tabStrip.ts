// Opening, closing, switching and renaming tabs, and the tab strip in the header.

import { api } from '../api';
import { refreshProcs } from '../devices';
import { els } from '../dom';
import { saveSettings } from '../settings';
import { state } from '../state';
import { renderDevice } from '../ui/deviceSelector';
import { showMenu } from '../ui/menu';
import { renderProc } from '../ui/processSelector';
import { renderQueryBox } from '../ui/queryBar';
import { hideSuggest } from '../ui/suggest';
import { renderToolbar } from '../ui/toolbar';
import { esc } from '../util/text';
import { render } from '../view/render';
import { renderNotice } from '../view/status';
import { Tab, type TabOptions } from './Tab';

export function renderTabs(): void {
  els.tabs.innerHTML = state.tabs.map((t, i) =>
    `<div class="tab${state.isActive(t) ? ' active' : ''}" data-i="${i}" title="${esc(t.file ?? t.name)}">` +
    `<span class="tab-name">${esc(t.name)}</span>` +
    `<button class="tab-close" data-close="${i}" title="Close tab"><svg><use href="#i-close"/></svg></button></div>`,
  ).join('');
}

export function activateTab(t: Tab): void {
  if (state.hasActive) state.active.scrollTop = els.log.scrollTop;
  state.active = t;
  els.query.value = t.query;
  hideSuggest();
  renderTabs();
  renderDevice();
  renderProc();
  renderQueryBox();
  renderToolbar();
  renderNotice();
  render();
  if (!t.follow) els.log.scrollTop = t.scrollTop;
  saveSettings();
}

export function addTab(opts: TabOptions, activate = true): Tab {
  const t = new Tab(opts);
  state.tabs.push(t);
  if (activate) activateTab(t);
  if (!t.file && t.device) { t.connect(); void refreshProcs(); }
  renderTabs();
  saveSettings();
  return t;
}

export function closeTab(t: Tab): void {
  const i = state.tabs.indexOf(t);
  if (i < 0) return;
  t.dispose();
  state.tabs.splice(i, 1);
  if (!state.tabs.length) {
    addTab({ device: t.device });
    return;
  }
  if (state.isActive(t)) activateTab(state.tabs[Math.min(i, state.tabs.length - 1)]);
  renderTabs();
  saveSettings();
}

function renameTab(t: Tab, tabEl: HTMLElement): void {
  const name = tabEl.querySelector('.tab-name');
  if (!name) return;
  const input = document.createElement('input');
  input.value = t.name;
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) t.name = input.value.trim();
    renderTabs();
    saveSettings();
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

function newTabForActiveDevice(): void {
  const t = state.active;
  addTab({ device: t.file ? '' : t.device });
}

const tabAt = (target: EventTarget | null) => {
  const tabEl = (target as Element | null)?.closest<HTMLElement>('.tab');
  return tabEl ? { tabEl, tab: state.tabs[Number(tabEl.dataset.i)] } : null;
};

export function initTabStrip(): void {
  els.tabs.addEventListener('mousedown', ev => {
    if (ev.button !== 1) return; // middle-click closes, like the IDE
    const hit = tabAt(ev.target);
    if (hit) { ev.preventDefault(); closeTab(hit.tab); }
  });
  els.tabs.addEventListener('click', ev => {
    const close = (ev.target as Element).closest<HTMLElement>('[data-close]');
    if (close) { closeTab(state.tabs[Number(close.dataset.close)]); return; }
    const hit = tabAt(ev.target);
    if (hit && !state.isActive(hit.tab)) activateTab(hit.tab);
  });
  els.tabs.addEventListener('dblclick', ev => {
    const hit = tabAt(ev.target);
    if (hit) renameTab(hit.tab, hit.tabEl);
  });
  els.tabs.addEventListener('contextmenu', ev => {
    const hit = tabAt(ev.target);
    if (!hit) return;
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, [
      { label: 'Rename Tab', action: () => renameTab(hit.tab, hit.tabEl) },
      { label: 'Close Tab', action: () => closeTab(hit.tab) },
      { label: 'Close Other Tabs', disabled: state.tabs.length < 2, action: () => state.tabs.filter(x => x !== hit.tab).forEach(closeTab) },
    ]);
  });
  els.addTab.addEventListener('click', newTabForActiveDevice);
  api.onMenu('newTab', newTabForActiveDevice);
}
