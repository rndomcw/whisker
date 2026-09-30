// Screen recording preview: play, trim, then copy to the clipboard or save.

import type { RecordingResult, TrimRange } from '../../shared/types';
import { api } from '../api';
import { toast } from '../ui/toast';
import { fileTimestamp, formatSize } from '../util/text';
import { button, openDialog } from './dialog';

/** m:ss.t */
function formatTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function openRecordingDialog(id: number, result: RecordingResult, deviceLabel: string, note = ''): void {
  const url = URL.createObjectURL(new Blob([result.data as BlobPart], { type: 'video/mp4' }));
  const duration = result.durationMs;
  let start = 0, end = duration;
  let stopAtEnd = false;

  const dialog = openDialog({
    title: `Screen Recording · ${deviceLabel}`,
    className: 'capture-dialog',
    onKey: ev => onKey(ev),
    onClose: () => {
      URL.revokeObjectURL(url);
      api.recordDiscard(id);
    },
  });

  // ----- player -----
  const stage = document.createElement('div');
  stage.className = 'capture-stage';
  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.preload = 'auto';
  stage.appendChild(video);

  // ----- trim timeline -----
  const trim = document.createElement('div');
  trim.className = 'trim';
  trim.innerHTML =
    '<div class="trim-track"><div class="trim-range"></div><div class="trim-head"></div>' +
    '<div class="trim-handle start" title="Drag to set the start"></div><div class="trim-handle end" title="Drag to set the end"></div></div>' +
    '<div class="trim-info"><span class="trim-start"></span><span class="trim-len"></span><span class="trim-end"></span></div>';
  const q = <T extends HTMLElement>(sel: string) => trim.querySelector<T>(sel)!;
  const track = q('.trim-track'), range = q('.trim-range'), head = q('.trim-head');
  const hStart = q('.trim-handle.start'), hEnd = q('.trim-handle.end');
  dialog.body.append(stage, trim);

  const pct = (ms: number) => `${(duration ? ms / duration : 0) * 100}%`;
  const trimmed = () => start > 0 || end < duration;

  function renderTrim(): void {
    hStart.style.left = pct(start);
    hEnd.style.left = pct(end);
    range.style.left = pct(start);
    range.style.width = `calc(${pct(end)} - ${pct(start)})`;
    q('.trim-start').textContent = `Start ${formatTime(start)}`;
    q('.trim-end').textContent = `End ${formatTime(end)}`;
    q('.trim-len').textContent = trimmed()
      ? `Selection ${formatTime(end - start)} of ${formatTime(duration)}`
      : `${formatTime(duration)} · ${result.width} × ${result.height} · ${formatSize(result.data.byteLength)}`;
    reset.disabled = !trimmed();
  }

  const msAt = (clientX: number) => {
    const r = track.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * duration;
  };

  function drag(handle: HTMLElement, which: 'start' | 'end'): void {
    handle.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      try { handle.setPointerCapture(ev.pointerId); } catch { /* keep dragging without capture */ }
      video.pause();
      const move = (e: PointerEvent) => {
        const ms = msAt(e.clientX);
        if (which === 'start') start = Math.min(ms, end - 100);
        else end = Math.max(ms, start + 100);
        video.currentTime = (which === 'start' ? start : end) / 1000;
        renderTrim();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
    });
  }
  drag(hStart, 'start');
  drag(hEnd, 'end');
  track.addEventListener('pointerdown', ev => { video.currentTime = msAt(ev.clientX) / 1000; });

  const updateHead = () => {
    const ms = video.currentTime * 1000;
    head.style.left = pct(ms);
    if (stopAtEnd && ms >= end) {
      video.pause();
      stopAtEnd = false;
    }
    if (!video.paused) requestAnimationFrame(updateHead);
  };
  video.addEventListener('play', () => requestAnimationFrame(updateHead));
  video.addEventListener('seeked', updateHead);
  video.addEventListener('pause', () => { stopAtEnd = false; });

  // ----- footer -----
  const playSel = button('i-play', 'Play Selection', 'Play the trimmed part', () => {
    video.currentTime = start / 1000;
    stopAtEnd = true;
    void video.play();
  });
  const reset = button('i-restart', 'Reset Trim', 'Use the whole recording', () => {
    start = 0;
    end = duration;
    renderTrim();
  });
  const rangeArg = (): TrimRange | null => (trimmed() ? { startMs: Math.round(start), endMs: Math.round(end) } : null);
  const copy = button('i-copy', 'Copy to Clipboard', 'Copy the video file, to paste into Explorer, Teams, Slack… (Ctrl+C)',
    () => void copyVideo());
  const save = button('i-save', 'Save…', 'Save as MP4 (Ctrl+S)', () => void saveVideo(), 'primary');
  const hint = document.createElement('span');
  hint.className = 'capture-hint';
  hint.textContent = note || 'Drag the handles to trim; Save and Copy use the selection.';
  dialog.footer.append(playSel, reset, hint, Object.assign(document.createElement('span'), { className: 'spacer' }), copy, save);

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

  renderTrim();
}
