import { els } from '../dom';

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the window. */
export function toast(text: string): void {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
}
