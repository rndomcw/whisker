// Renders the open popup menu (see state/menu.ts), keeping it inside the window.

import { createEffect, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { closeMenu, type MenuItem, openMenu } from '../state/menu';
import { Icon } from './Icon';
import { cx, type MenuKind, menuBox, menuHeader, menuHint, menuItem, menuLabel, menuSeparator } from './ui';

type ActionItem = Extract<MenuItem, { label: string }>;

function MenuItems(props: { items: MenuItem[] }) {
  const checks = () => props.items.some(it => typeof it === 'object' && 'label' in it && it.checked !== undefined);
  const run = (it: ActionItem, ev: MouseEvent) => {
    if (it.disabled) return;
    if (it.remove && (ev.target as Element).closest('[data-remove]')) { closeMenu(); it.remove(); return; }
    closeMenu();
    it.action?.();
  };
  return (
    <For each={props.items}>
      {it => (
        <Switch>
          <Match when={it === '-'}><div class={menuSeparator} /></Match>
          <Match when={typeof it === 'object' && 'header' in it && it}>{h => <div class={menuHeader}>{h().header}</div>}</Match>
          <Match when={typeof it === 'object' && 'content' in it && it}>{c => c().content()}</Match>
          <Match when={typeof it === 'object' && 'label' in it && it}>
            {item => (
              <div class={menuItem({ disabled: item().disabled })} onClick={ev => run(item(), ev)}>
                <Show when={checks()}>
                  <span class="inline-flex w-4"><Show when={item().checked}><Icon name="check" /></Show></span>
                </Show>
                <span class={menuLabel}>{item().label}</span>
                <Show when={item().hint}><span class={menuHint()}>{item().hint}</span></Show>
                <Show when={item().remove}>
                  <span data-remove class="ml-2 inline-flex opacity-60 hover:opacity-100" title="Remove"><Icon name="close" /></span>
                </Show>
              </div>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}

function PopupMenu(props: { x: number; y: number; kind: MenuKind; items: MenuItem[] }) {
  let el!: HTMLDivElement;
  onMount(() => {
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(props.x, innerWidth - r.width - 4)) + 'px';
    el.style.top = (props.y + r.height > innerHeight - 4 ? Math.max(4, props.y - r.height) : props.y) + 'px';
  });
  return (
    <div ref={el} data-menu class={cx(menuBox(props.kind))} style={{ left: `${props.x}px`, top: `${props.y}px` }}>
      <MenuItems items={props.items} />
    </div>
  );
}

export function MenuHost() {
  // The anchor button shows as pressed while its dropdown is open.
  createEffect(() => {
    const anchor = openMenu()?.anchor;
    if (!anchor) return;
    anchor.classList.add('open');
    onCleanup(() => anchor.classList.remove('open'));
  });

  onMount(() => {
    const onDown = (ev: MouseEvent) => {
      const m = openMenu();
      if (!m) return;
      const target = ev.target as Element;
      // Clicks on the anchor are left to its own handler, which toggles the menu.
      if (!target.closest('[data-menu]') && !m.anchor?.contains(target)) closeMenu();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', closeMenu);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', closeMenu);
    });
  });

  return <Show when={openMenu()} keyed>{m => <PopupMenu x={m.x} y={m.y} kind={m.kind} items={m.items} />}</Show>;
}
