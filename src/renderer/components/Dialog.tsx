// A modal dialog over the whole window; open one with state/dialog.ts's openDialog().

import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { closeDialog, currentDialog } from '../state/dialog';
import { Icon } from './Icon';

export interface DialogProps {
  title: string;
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
    <div class="modal-backdrop">
      <div class={`modal ${props.class ?? ''}`} role="dialog" aria-modal="true">
        <div class="modal-head">
          <span class="modal-title">{props.title}</span>
          <span class="spacer" />
          <button class="icon-btn small" title="Close (Esc)" onClick={closeDialog}><Icon name="close" /></button>
        </div>
        <div class="modal-toolbar">{props.toolbar}</div>
        <div class="modal-body">{props.children}</div>
        <div class="modal-footer">{props.footer}</div>
      </div>
    </div>
  );
}

/** A toolbar/footer button with an icon and an optional label. */
export function DialogButton(props: {
  icon: string; label?: string; title: string; onClick: () => void; class?: string; disabled?: boolean; on?: boolean;
}) {
  return (
    <button
      class={`${props.label ? 'dlg-btn' : 'icon-btn'} ${props.class ?? ''}`}
      classList={{ on: props.on }}
      title={props.title}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <Icon name={props.icon} />
      <Show when={props.label}><span>{props.label}</span></Show>
    </button>
  );
}

export const Separator = () => <span class="tool-sep vertical" />;

export function DialogHost() {
  return <Show when={currentDialog()} keyed>{render => render()}</Show>;
}
