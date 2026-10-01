// A short message at the bottom of the window, optionally with one action button (components/Toast.tsx).

import { createSignal } from 'solid-js';

export interface ToastAction {
  label: string;
  run(): void;
}

const [current, setCurrent] = createSignal<{ text: string; action?: ToastAction } | null>(null);
export const currentToast = current;

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, action?: ToastAction): void {
  setCurrent({ text, action });
  clearTimeout(timer);
  timer = setTimeout(hideToast, action ? 5000 : 2800);
}

export function hideToast(): void {
  clearTimeout(timer);
  setCurrent(null);
}
