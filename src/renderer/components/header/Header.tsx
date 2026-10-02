// The title bar: the Whisker logo and name (which open the application menu), and the tab strip.

import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../../api';
import { state } from '../../state/app';
import { showMenu } from '../../state/menu';
import { activateTab, closeTab, newTabForActiveDevice, renameTab } from '../../state/tabActions';
import type { Tab } from '../../state/Tab';
import { Icon } from '../Icon';
import { cx, IconButton } from '../ui';

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
    <button
      ref={btn}
      id="appMenu"
      class="app-brand -ml-1.5 mr-2 inline-flex h-7 items-center gap-1.5 rounded-[5px] px-1.5 text-fg hover:bg-hover active:bg-press"
      title="Menu (Alt)"
      onClick={open}
    >
      <img class="size-[14px] flex-none" src="logo.svg" alt="" />
      <span class="text-[14px] font-medium">Whisker</span>
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
      data-tab
      class={cx(
        'flex h-[26px] cursor-default items-center gap-0.5 whitespace-nowrap rounded-[5px] border pr-1 pl-2',
        state.isActive(t) ? 'border-tab-active-border bg-tab-active' : 'border-transparent hover:bg-hover',
      )}
      title={t.file ?? t.name}
      onClick={() => { if (!state.isActive(t)) activateTab(t); }}
      onDblClick={() => props.onEdit(true)}
      onMouseDown={ev => { if (ev.button === 1) { ev.preventDefault(); closeTab(t); } }} // middle-click, like the IDE
      onContextMenu={menu}
    >
      <Show when={props.editing} fallback={<span class="max-w-[180px] overflow-hidden text-ellipsis">{t.name}</span>}>
        <input
          ref={el => setTimeout(() => { el.focus(); el.select(); })}
          class="w-[120px] rounded-[3px] border border-accent bg-input px-1 text-fg outline-none [font:inherit]"
          value={t.name}
          onKeyDown={ev => {
            ev.stopPropagation();
            if (ev.key === 'Enter') finish(ev.currentTarget, true);
            else if (ev.key === 'Escape') finish(ev.currentTarget, false);
          }}
          onBlur={ev => finish(ev.currentTarget, true)}
        />
      </Show>
      <button
        class="inline-flex size-[18px] items-center justify-center rounded-[3px] text-dim hover:bg-press hover:text-fg [&_svg]:size-3"
        title="Close tab" onClick={ev => { ev.stopPropagation(); closeTab(t); }}>
        <Icon name="close" />
      </button>
    </div>
  );
}

export function Header() {
  const [editing, setEditing] = createSignal<Tab | null>(null);
  return (
    <header class="app-header flex h-9 items-center gap-1 bg-panel">
      <AppBrand />
      <div class="flex min-w-0 gap-0.5 overflow-hidden">
        <For each={state.tabs}>
          {t => <TabItem tab={t} editing={editing() === t} onEdit={on => setEditing(on ? t : null)} />}
        </For>
      </div>
      <IconButton icon="plus" title="New tab (Ctrl+T)" onClick={newTabForActiveDevice} />
      <span class="drag-fill flex-1 self-stretch" />
    </header>
  );
}
