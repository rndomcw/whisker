// A modal dialog over the whole window; open one with state/dialog.ts's openDialog().

import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { closeDialog, currentDialog } from '../state/dialog';
import { Icon } from './Icon';
import { cx, IconButton, textButton } from './ui';

export interface DialogProps {
  title: string;
  /** Size classes for the dialog box. */
  class?: string;
  /** Row under the title. */
  toolbar?: JSX.Element;
  footer?: JSX.Element;
  children: JSX.Element;
  /** Handles a key press; return true when handled. Escape closes the dialog unless handled here. */
  onKey?(ev: KeyboardEvent): boolean;
}

export function Dialog(props: DialogProps) {
  onMount(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (props.onKey?.(ev)) { ev.preventDefault(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); closeDialog(); }
    };
    // Capture phase, so the dialog gets keys before the app's shortcuts.
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });
  return (
    <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/55">
      <div
        role="dialog"
        aria-modal="true"
        class={cx(
          'flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[10px]',
          'border border-menu-border bg-panel shadow-[0_12px_48px_rgba(0,0,0,.5)]',
          props.class,
        )}
      >
        <div class="flex h-10 items-center gap-1.5 pr-2 pl-4 font-semibold">
          <span>{props.title}</span>
          <span class="flex-1" />
          <IconButton small icon="close" title="Close (Esc)" onClick={closeDialog} />
        </div>
        <Show when={props.toolbar}>
          <div class="flex items-center gap-0.5 border-y border-line px-2.5 py-1">{props.toolbar}</div>
        </Show>
        <div class="flex min-h-0 flex-1 flex-col bg-bg">{props.children}</div>
        <div class="flex items-center gap-2 border-t border-line px-3 py-2.5">{props.footer}</div>
      </div>
    </div>
  );
}

/** A toolbar/footer button: an icon button, or a text button with an icon when it has a label. */
export function DialogButton(props: {
  icon: string; label?: string; title: string; onClick: () => void; primary?: boolean; disabled?: boolean; on?: boolean;
}) {
  return (
    <Show
      when={props.label}
      fallback={<IconButton icon={props.icon} title={props.title} on={props.on} disabled={props.disabled} onClick={() => props.onClick()} />}
    >
      <button class={textButton(props.primary)} title={props.title} disabled={props.disabled} onClick={() => props.onClick()}>
        <Icon name={props.icon} />
        <span>{props.label}</span>
      </button>
    </Show>
  );
}

export function DialogHost() {
  return <Show when={currentDialog()} keyed>{render => render()}</Show>;
}
