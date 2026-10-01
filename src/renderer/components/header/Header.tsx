// The title bar: the Whisker logo and name (which open the application menu), and the tab strip.

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../../api';
import { state } from '../../state/app';
import { showMenu } from '../../state/menu';
import { activateTab, closeTab, newTabForActiveDevice, renameTab } from '../../state/tabActions';
import type { Tab } from '../../state/Tab';
import { Icon } from '../Icon';

/**
 * The name and logo pop up the application menu (File, Capture, View), which the custom title bar
 * hides on Windows/Linux. Pressing and releasing Alt on its own opens it too, like a native menu bar.
 */
function AppBrand() {
  let btn!: HTMLButtonElement;
  const open = () => {
    const r = btn.getBoundingClientRect();
    api.showAppMenu(r.left, r.bottom + 2);
  };
  onMount(() => {
    if (api.platform === 'darwin') return; // macOS shows the menu at the top of the screen
    let altAlone = false;
    const down = (ev: KeyboardEvent) => { altAlone = ev.key === 'Alt' && !ev.repeat; };
    const mouse = () => { altAlone = false; };
    const up = (ev: KeyboardEvent) => {
      if (ev.key === 'Alt' && altAlone) { ev.preventDefault(); open(); }
      altAlone = false;
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('mousedown', mouse, true);
    document.addEventListener('keyup', up, true);
    onCleanup(() => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('mousedown', mouse, true);
      document.removeEventListener('keyup', up, true);
    });
  });
  return (
    <button ref={btn} id="appMenu" class="app-brand" title="Menu (Alt)" onClick={open}>
      <img class="app-logo" src="logo.svg" alt="" />
      <span class="panel-title">Whisker</span>
    </button>
  );
}

function TabItem(props: { tab: Tab; editing: boolean; onEdit(editing: boolean): void }) {
  const t = props.tab;
  const finish = (input: HTMLInputElement, commit: boolean) => {
    if (!props.editing) return;
    if (commit) renameTab(t, input.value);
    props.onEdit(false);
  };
  const menu = (ev: MouseEvent) => {
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, [
      { label: 'Rename Tab', action: () => props.onEdit(true) },
      { label: 'Close Tab', action: () => closeTab(t) },
      {
        label: 'Close Other Tabs',
        disabled: state.tabs.length < 2,
        action: () => state.tabs.filter(x => x !== t).forEach(closeTab),
      },
    ]);
  };
  return (
    <div
      class="tab"
      classList={{ active: state.isActive(t) }}
      title={t.file ?? t.name}
      onClick={() => { if (!state.isActive(t)) activateTab(t); }}
      onDblClick={() => props.onEdit(true)}
      onMouseDown={ev => { if (ev.button === 1) { ev.preventDefault(); closeTab(t); } }} // middle-click, like the IDE
      onContextMenu={menu}
    >
      <Show when={props.editing} fallback={<span class="tab-name">{t.name}</span>}>
        <input
          ref={el => setTimeout(() => { el.focus(); el.select(); })}
          value={t.name}
          onKeyDown={ev => {
            ev.stopPropagation();
            if (ev.key === 'Enter') finish(ev.currentTarget, true);
            else if (ev.key === 'Escape') finish(ev.currentTarget, false);
          }}
          onBlur={ev => finish(ev.currentTarget, true)}
        />
      </Show>
      <button class="tab-close" title="Close tab" onClick={ev => { ev.stopPropagation(); closeTab(t); }}>
        <Icon name="close" />
      </button>
    </div>
  );
}

export function Header() {
  const [editing, setEditing] = createSignal<Tab | null>(null);
  return (
    <header class="header">
      <AppBrand />
      <div class="tabs">
        <For each={state.tabs}>
          {t => <TabItem tab={t} editing={editing() === t} onEdit={on => setEditing(on ? t : null)} />}
        </For>
      </div>
      <button class="icon-btn" title="New tab (Ctrl+T)" onClick={newTabForActiveDevice}><Icon name="plus" /></button>
      <span class="drag-fill" />
    </header>
  );
}
