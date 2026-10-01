// Screen recording preview: play, trim, then copy to the clipboard or save.

import { createSignal, onCleanup, onMount } from 'solid-js';
import type { RecordingResult, TrimRange } from '../../../shared/types';
import { api } from '../../api';
import { openDialog } from '../../state/dialog';
import { toast } from '../../state/toast';
import { fileTimestamp, formatSize } from '../../util/text';
import { Dialog, DialogButton } from '../Dialog';

/** m:ss.t */
function formatTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function openRecordingDialog(id: number, result: RecordingResult, deviceLabel: string, note = ''): void {
  openDialog(() => <RecordingDialog id={id} result={result} deviceLabel={deviceLabel} note={note} />);
}

function RecordingDialog(props: { id: number; result: RecordingResult; deviceLabel: string; note: string }) {
  const { id, result, deviceLabel } = props;
  const url = URL.createObjectURL(new Blob([result.data as BlobPart], { type: 'video/mp4' }));
  const duration = result.durationMs;
  const [start, setStart] = createSignal(0);
  const [end, setEnd] = createSignal(duration);
  const [head, setHead] = createSignal(0);
  let video!: HTMLVideoElement;
  let track!: HTMLDivElement;
  let stopAtEnd = false;

  // Closing the dialog frees the video and the recording kept in the main process.
  onCleanup(() => {
    URL.revokeObjectURL(url);
    api.recordDiscard(id);
  });

  const pct = (ms: number) => `${(duration ? ms / duration : 0) * 100}%`;
  const trimmed = () => start() > 0 || end() < duration;
  const rangeArg = (): TrimRange | null => (trimmed() ? { startMs: Math.round(start()), endMs: Math.round(end()) } : null);

  const msAt = (clientX: number) => {
    const r = track.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * duration;
  };

  function dragHandle(which: 'start' | 'end') {
    return (ev: PointerEvent) => {
      const handle = ev.currentTarget as HTMLElement;
      ev.preventDefault();
      ev.stopPropagation();
      try { handle.setPointerCapture(ev.pointerId); } catch { /* keep dragging without capture */ }
      video.pause();
      const move = (e: PointerEvent) => {
        const ms = msAt(e.clientX);
        if (which === 'start') setStart(Math.min(ms, end() - 100));
        else setEnd(Math.max(ms, start() + 100));
        video.currentTime = (which === 'start' ? start() : end()) / 1000;
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
    };
  }

  const updateHead = () => {
    const ms = video.currentTime * 1000;
    setHead(ms);
    if (stopAtEnd && ms >= end()) {
      video.pause();
      stopAtEnd = false;
    }
    if (!video.paused) requestAnimationFrame(updateHead);
  };

  onMount(() => {
    video.addEventListener('play', () => requestAnimationFrame(updateHead));
    video.addEventListener('seeked', updateHead);
    video.addEventListener('pause', () => { stopAtEnd = false; });
  });

  function playSelection(): void {
    video.currentTime = start() / 1000;
    stopAtEnd = true;
    void video.play();
  }

  async function copyVideo(): Promise<void> {
    try {
      await api.recordCopy(id, rangeArg());
      toast('Recording copied to the clipboard as a file');
    } catch (e) {
      toast('Copy failed: ' + (e as Error).message);
    }
  }

  async function saveVideo(): Promise<void> {
    try {
      const file = `screenrecord-${deviceLabel.replace(/[^\w.-]+/g, '_')}-${fileTimestamp()}.mp4`;
      const saved = await api.recordSave(id, rangeArg(), file);
      if (saved) toast('Recording saved to ' + saved);
    } catch (e) {
      toast('Save failed: ' + (e as Error).message);
    }
  }

  function onKey(ev: KeyboardEvent): boolean {
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (mod && k === 'c') { void copyVideo(); return true; }
    if (mod && k === 's') { void saveVideo(); return true; }
    if (k === ' ' && ev.target === document.body) { if (video.paused) void video.play(); else video.pause(); return true; }
    return false;
  }

  return (
    <Dialog
      title={`Screen Recording · ${deviceLabel}`}
      class="capture-dialog"
      onKey={onKey}
      footer={<>
        <DialogButton icon="play" label="Play Selection" title="Play the trimmed part" onClick={playSelection} />
        <DialogButton icon="restart" label="Reset Trim" title="Use the whole recording" disabled={!trimmed()}
          onClick={() => { setStart(0); setEnd(duration); }} />
        <span class="capture-hint">{props.note || 'Drag the handles to trim; Save and Copy use the selection.'}</span>
        <span class="spacer" />
        <DialogButton icon="copy" label="Copy to Clipboard"
          title="Copy the video file, to paste into Explorer, Teams, Slack… (Ctrl+C)" onClick={() => void copyVideo()} />
        <DialogButton icon="save" label="Save…" title="Save as MP4 (Ctrl+S)" class="primary" onClick={() => void saveVideo()} />
      </>}
    >
      <div class="capture-stage">
        <video ref={video} src={url} controls preload="auto" />
      </div>
      <div class="trim">
        <div class="trim-track" ref={track} onPointerDown={ev => { video.currentTime = msAt(ev.clientX) / 1000; }}>
          <div class="trim-range" style={{ left: pct(start()), width: `calc(${pct(end())} - ${pct(start())})` }} />
          <div class="trim-head" style={{ left: pct(head()) }} />
          <div class="trim-handle start" title="Drag to set the start" style={{ left: pct(start()) }} onPointerDown={dragHandle('start')} />
          <div class="trim-handle end" title="Drag to set the end" style={{ left: pct(end()) }} onPointerDown={dragHandle('end')} />
        </div>
        <div class="trim-info">
          <span class="trim-start">Start {formatTime(start())}</span>
          <span class="trim-len">
            {trimmed()
              ? `Selection ${formatTime(end() - start())} of ${formatTime(duration)}`
              : `${formatTime(duration)} · ${result.width} × ${result.height} · ${formatSize(result.data.byteLength)}`}
          </span>
          <span class="trim-end">End {formatTime(end())}</span>
        </div>
      </div>
    </Dialog>
  );
}
