// The REC badge over the log while recording: time, size and a Stop button.

import { Show } from 'solid-js';
import { recording, stopRecording } from '../../state/recorder';
import { formatSize } from '../../util/text';
import { Icon } from '../Icon';

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function RecBadge() {
  return (
    <Show when={recording()}>
      {r => (
        <div class="rec-badge" classList={{ live: r().started }}>
          <span class="rec-dot" />
          <span>
            {r().stopping ? 'Finishing…'
              : r().started ? `REC ${formatClock(r().durationMs)} · ${formatSize(r().bytes)}`
                : 'Starting recorder…'}
          </span>
          <button class="rec-stop" title="Stop recording" disabled={r().stopping} onClick={() => void stopRecording()}>
            <Icon name="stop" /> Stop
          </button>
        </div>
      )}
    </Show>
  );
}
