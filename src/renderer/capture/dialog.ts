// A modal dialog over the whole window. Only one is open at a time.

export interface Dialog {
  root: HTMLElement;
  /** Toolbar row under the title (empty until filled). */
  toolbar: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  setTitle(text: string): void;
  close(): void;
}

interface DialogOptions {
  title: string;
  className?: string;
  /** Handles a key press; return true when handled. Escape closes the dialog unless handled here. */
  onKey?(ev: KeyboardEvent): boolean;
  onClose?(): void;
}

let current: Dialog | null = null;

export const isDialogOpen = () => current !== null;

export function openDialog(opts: DialogOptions): Dialog {
  current?.close();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML =
    `<div class="modal ${opts.className ?? ''}" role="dialog" aria-modal="true">` +
    '<div class="modal-head"><span class="modal-title"></span><span class="spacer"></span>' +
    '<button class="icon-btn small" data-close title="Close (Esc)"><svg><use href="#i-close"/></svg></button></div>' +
    '<div class="modal-toolbar"></div><div class="modal-body"></div><div class="modal-footer"></div></div>';
  const q = <T extends HTMLElement>(sel: string) => backdrop.querySelector<T>(sel)!;
  const title = q('.modal-title');

  const onKey = (ev: KeyboardEvent) => {
    if (opts.onKey?.(ev)) { ev.preventDefault(); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); dialog.close(); }
  };

  const dialog: Dialog = {
    root: q('.modal'),
    toolbar: q('.modal-toolbar'),
    body: q('.modal-body'),
    footer: q('.modal-footer'),
    setTitle: text => { title.textContent = text; },
    close() {
      if (current !== dialog) return;
      current = null;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      opts.onClose?.();
    },
  };
  dialog.setTitle(opts.title);
  q('[data-close]').addEventListener('click', () => dialog.close());
  // Capture phase, so the dialog gets keys before the app's shortcuts.
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  current = dialog;
  return dialog;
}

/** A toolbar/footer button with an icon and optional label. */
export function button(icon: string, label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = (label ? 'dlg-btn ' : 'icon-btn ') + cls;
  b.title = title;
  b.innerHTML = `<svg><use href="#${icon}"/></svg>` + (label ? `<span>${label}</span>` : '');
  b.addEventListener('click', onClick);
  return b;
}

export function separator(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'tool-sep vertical';
  return s;
}
