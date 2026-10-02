// The REC badge over the log while recording: time, size and a Stop button.

import { Show } from 'solid-js';
import { recording, stopRecording } from '../../state/recorder';
import { formatSize } from '../../util/text';
import { Icon } from '../Icon';
import { cx } from '../ui';

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function RecBadge() {
  return (
    <Show when={recording()}>
      {r => (
        <div class="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-menu-border bg-menu py-1 pr-1.5 pl-3 tabular-nums shadow-[0_4px_16px_rgba(0,0,0,.35)]">
          <span class={cx('size-[9px] rounded-full', r().started ? 'animate-blink bg-rec' : 'bg-dim')} />
          <span>
            {r().stopping ? 'Finishing…'
              : r().started ? `REC ${formatClock(r().durationMs)} · ${formatSize(r().bytes)}`
                : 'Starting recorder…'}
          </span>
          <button
            class="inline-flex h-6 items-center gap-1 rounded-xl bg-rec px-2.5 font-semibold text-white disabled:opacity-50 [&_svg]:size-3"
            title="Stop recording"
            disabled={r().stopping}
            onClick={() => void stopRecording()}
          >
            <Icon name="stop" /> Stop
          </button>
        </div>
      )}
    </Show>
  );
}
