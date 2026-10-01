// The modal dialog over the whole window (components/Dialog.tsx). Only one is open at a time.

import { createSignal, type JSX } from 'solid-js';

const [current, setCurrent] = createSignal<(() => JSX.Element) | null>(null);
export const currentDialog = current;

export const isDialogOpen = () => current() !== null;

/** Shows a dialog; `render` returns a <Dialog> element. */
export function openDialog(render: () => JSX.Element): void {
  setCurrent(() => render);
}

export function closeDialog(): void {
  setCurrent(null);
}
