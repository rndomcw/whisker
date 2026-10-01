// The toast at the bottom of the window (see state/toast.ts).

import { Show } from 'solid-js';
import { currentToast, hideToast } from '../state/toast';

export function Toast() {
  return (
    <Show when={currentToast()} keyed>
      {t => (
        <div class="toast">
          {t.text}
          <Show when={t.action}>
            {action => <button class="toast-action" onClick={() => { hideToast(); action().run(); }}>{action().label}</button>}
          </Show>
        </div>
      )}
    </Show>
  );
}
