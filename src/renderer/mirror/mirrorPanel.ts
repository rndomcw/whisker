// The device mirroring panel: session lifecycle, video, toolbar buttons and resizing.

import type { MirrorEvent } from '../../shared/types';
import { api } from '../api';
import { el } from '../dom';
import { KEY, MSG, simpleMessage } from './control';
import { MirrorDecoder } from './decoder';
import { bindInput, press } from './input';

export interface MirrorTarget {
  serial: string;
  label: string;
  online: boolean;
}

interface PanelHooks {
  onClose(): void;
  onResize(width: number): void;
}

const els = {
  panel: el('mirror'),
  split: el('mirrorSplit'),
  title: el('mirrorTitle'),
  stage: el('mirrorStage'),
  canvas: el<HTMLCanvasElement>('mirrorCanvas'),
  status: el('mirrorStatus'),
  input: el<HTMLTextAreaElement>('mirrorInput'),
};

const STREAM_OPTIONS = { maxSize: 1280, bitRate: 8000000, maxFps: 60 };
/** Automatic (re)starts stop after this many consecutive failures; Retry resets it. */
const MAX_AUTO_STARTS = 3;

let open = false;
let target: MirrorTarget = { serial: '', label: '', online: false };
let sessionId = 0;          // active session (0 = none)
let seq = 0;
let failures = 0;
let video = { w: 0, h: 0 };
let lastReset = 0;
let hooks: PanelHooks = { onClose() {}, onResize() {} };
let ctx: CanvasRenderingContext2D | null = null;

function send(bytes: Uint8Array): void {
  if (sessionId) api.mirrorControl(sessionId, bytes);
}

// Ask the server to restart encoding, which sends a fresh config + key frame.
function requestKeyFrame(): void {
  if (Date.now() - lastReset < 1000) return;
  lastReset = Date.now();
  send(simpleMessage(MSG.RESET_VIDEO));
}

const decoder = new MirrorDecoder(drawFrame, requestKeyFrame);

function setStatus(text: string, { error = false, retry = false } = {}): void {
  els.status.textContent = text;
  els.status.classList.toggle('error', error);
  if (retry) {
    const b = document.createElement('button');
    b.textContent = 'Retry';
    b.addEventListener('click', () => { failures = 0; start(); });
    els.status.append(document.createElement('br'), b);
  }
  els.status.hidden = !text;
}

function start(): void {
  stop();
  if (!target.serial || !target.online) return;
  sessionId = ++seq;
  video = { w: 0, h: 0 };
  setStatus('Connecting…');
  api.mirrorStart(sessionId, target.serial, STREAM_OPTIONS);
}

function stop(): void {
  if (sessionId) api.mirrorStop(sessionId);
  sessionId = 0;
  decoder.close();
  els.canvas.hidden = true;
}

function onEvent(event: MirrorEvent): void {
  switch (event.type) {
    case 'status': setStatus(event.text); break;
    case 'device': if (!target.label) els.title.textContent = event.name; break;
    case 'session': video = { w: event.width, h: event.height }; fit(); break;
    case 'packet': decoder.push(event); break;
    case 'end':
      sessionId = 0;
      failures++;
      decoder.close();
      els.canvas.hidden = true;
      setStatus(event.error || 'Mirroring stopped', { error: true, retry: true });
      break;
  }
}

function drawFrame(frame: VideoFrame): void {
  const w = frame.displayWidth, h = frame.displayHeight;
  if (els.canvas.width !== w || els.canvas.height !== h) {
    els.canvas.width = w;
    els.canvas.height = h;
    fit();
  }
  ctx ??= els.canvas.getContext('2d');
  ctx?.drawImage(frame, 0, 0);
  if (els.canvas.hidden) {
    els.canvas.hidden = false;
    failures = 0;
    setStatus('');
    fit();
  }
}

/** Scales the canvas to fit the panel, keeping the device's aspect ratio. */
function fit(): void {
  const w = els.canvas.width, h = els.canvas.height;
  if (!w || !h) return;
  const sw = els.stage.clientWidth - 24, sh = els.stage.clientHeight - 24;
  const scale = Math.max(0.05, Math.min(sw / w, sh / h));
  els.canvas.style.width = Math.floor(w * scale) + 'px';
  els.canvas.style.height = Math.floor(h * scale) + 'px';
}

/** Shows the given device; (re)starts or stops mirroring as needed while the panel is open. */
export function updateMirrorTarget(next: MirrorTarget): void {
  const changed = next.serial !== target.serial;
  target = next;
  els.title.textContent = target.label || 'No device';
  els.title.title = target.serial;
  if (!open) return;
  if (changed) { failures = 0; stop(); }
  if (!target.serial) { stop(); setStatus('No device selected'); return; }
  if (!target.online) {
    if (!sessionId) setStatus('Device is not connected');
    return;
  }
  if (!sessionId && failures < MAX_AUTO_STARTS) start();
}

export function setMirrorOpen(v: boolean): void {
  open = v;
  els.panel.hidden = !v;
  els.split.hidden = !v;
  if (v) { failures = 0; updateMirrorTarget(target); } else stop();
}

export const isMirrorOpen = () => open;

function setWidth(w: number): void {
  document.documentElement.style.setProperty('--mirror-w', Math.round(w) + 'px');
}

function onToolbarClick(ev: MouseEvent): void {
  const btn = (ev.target as Element).closest<HTMLElement>('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  switch (act) {
    case 'power': press(send, KEY.POWER); break;
    case 'volup': press(send, KEY.VOLUME_UP); break;
    case 'voldown': press(send, KEY.VOLUME_DOWN); break;
    case 'rotate': send(simpleMessage(MSG.ROTATE)); break;
    case 'notifications': send(simpleMessage(MSG.EXPAND_NOTIFICATIONS)); break;
    case 'back': press(send, KEY.BACK); break;
    case 'home': press(send, KEY.HOME); break;
    case 'recents': press(send, KEY.APP_SWITCH); break;
    case 'restart': failures = 0; start(); break;
    case 'close': setMirrorOpen(false); hooks.onClose(); break;
  }
  if (act !== 'close') els.input.focus({ preventScroll: true });
}

function onSplitterDown(ev: PointerEvent): void {
  ev.preventDefault();
  els.split.setPointerCapture(ev.pointerId);
  els.split.classList.add('dragging');
  const startX = ev.clientX;
  const startW = els.panel.getBoundingClientRect().width;
  const maxW = () => Math.max(260, (els.panel.parentElement?.clientWidth ?? 1200) - 420);
  const move = (e: PointerEvent) => setWidth(Math.min(maxW(), Math.max(220, startW - (e.clientX - startX))));
  const end = () => {
    els.split.classList.remove('dragging');
    els.split.removeEventListener('pointermove', move);
    hooks.onResize(els.panel.getBoundingClientRect().width);
  };
  els.split.addEventListener('pointermove', move);
  els.split.addEventListener('pointerup', end, { once: true });
}

export function initMirrorPanel(opts: Partial<PanelHooks> & { width?: number }): void {
  hooks = { ...hooks, ...opts };
  if (opts.width) setWidth(opts.width);
  api.onMirror((id, event) => { if (id === sessionId) onEvent(event); });
  new ResizeObserver(fit).observe(els.stage);
  bindInput({
    canvas: els.canvas,
    input: els.input,
    stage: els.stage,
    videoSize: () => ({ w: video.w || els.canvas.width, h: video.h || els.canvas.height }),
    send,
  });
  els.panel.querySelector<HTMLElement>('.mirror-bar')!.addEventListener('click', onToolbarClick);
  els.split.addEventListener('pointerdown', onSplitterDown);
}
