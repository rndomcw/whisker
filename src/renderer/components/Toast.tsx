// The toast at the bottom of the window (see state/toast.ts).

import { Show } from 'solid-js';
import { currentToast, hideToast } from '../state/toast';

export function Toast() {
  return (
    <Show when={currentToast()} keyed>
      {t => (
        <div class="fixed bottom-7 left-1/2 z-[120] max-w-[80vw] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-menu-border bg-menu px-[14px] py-[7px] shadow-[0_4px_16px_rgba(0,0,0,.35)]">
          {t.text}
          <Show when={t.action}>
            {action => (
              <button class="ml-3 rounded bg-accent px-2.5 py-0.5 font-semibold text-white" onClick={() => { hideToast(); action().run(); }}>
                {action().label}
              </button>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
