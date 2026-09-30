import { els } from '../dom';

export interface ToastAction {
  label: string;
  run(): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the window, optionally with one action button. */
export function toast(text: string, action?: ToastAction): void {
  els.toast.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      els.toast.hidden = true;
      action.run();
    });
    els.toast.appendChild(b);
  }
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, action ? 5000 : 2800);
}
