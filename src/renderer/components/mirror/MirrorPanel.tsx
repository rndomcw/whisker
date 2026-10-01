// The device mirroring panel: session lifecycle, video, toolbar buttons and resizing. It is mounted
// while the panel is open, and follows the active tab's device.

import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import type { MirrorEvent } from '../../../shared/types';
import { api } from '../../api';
import { KEY, MSG, simpleMessage } from '../../mirror/control';
import { MirrorDecoder } from '../../mirror/MirrorDecoder';
import { bindInput, press } from '../../mirror/input';
import { state } from '../../state/app';
import { deviceName, deviceOnline } from '../../state/devices';
import { saveSettings, settings } from '../../state/settings';
import { Icon } from '../Icon';

const STREAM_OPTIONS = { maxSize: 1280, bitRate: 8000000, maxFps: 60 };
/** Automatic (re)starts stop after this many consecutive failures; Retry resets it. */
const MAX_AUTO_STARTS = 3;
const RETRY_MS = 2000;

/** Session ids stay unique across panel instances, so late events from an old session are ignored. */
let seq = 0;
let onMirrorEvent: ((id: number, event: MirrorEvent) => void) | null = null;
let listening = false;

interface Status {
  text: string;
  error?: boolean;
  retry?: boolean;
}

export function setMirrorOpen(open: boolean): void {
  settings.mirror = open;
  saveSettings();
}

export function MirrorPanel() {
  let panel!: HTMLElement;
  let split!: HTMLDivElement;
  let stage!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let input!: HTMLTextAreaElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let sessionId = 0; // active session (0 = none)
  let failures = 0;
  let video = { w: 0, h: 0 };
  let lastReset = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const [status, setStatus] = createSignal<Status>({ text: '' });
  const [showing, setShowing] = createSignal(false);
  const [deviceLabel, setDeviceLabel] = createSignal('');

  const target = createMemo(() => {
    const t = state.active;
    const serial = t.file ? '' : t.device;
    return { serial, label: serial ? deviceName(serial) : '', online: !!serial && deviceOnline(serial) };
  }, undefined, { equals: (a, b) => a.serial === b.serial && a.label === b.label && a.online === b.online });

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

  function start(): void {
    stop();
    const tg = target();
    if (!tg.serial || !tg.online) return;
    sessionId = ++seq;
    video = { w: 0, h: 0 };
    setStatus({ text: 'Connecting…' });
    api.mirrorStart(sessionId, tg.serial, STREAM_OPTIONS);
  }

  function stop(): void {
    clearTimeout(retryTimer);
    if (sessionId) api.mirrorStop(sessionId);
    sessionId = 0;
    decoder.close();
    setShowing(false);
  }

  function retry(): void {
    failures = 0;
    start();
  }

  function onEvent(event: MirrorEvent): void {
    switch (event.type) {
      case 'status': setStatus({ text: event.text }); break;
      case 'device': setDeviceLabel(event.name); break;
      case 'session': video = { w: event.width, h: event.height }; fit(); break;
      case 'packet': decoder.push(event); break;
      case 'end':
        sessionId = 0;
        failures++;
        decoder.close();
        setShowing(false);
        setStatus({ text: event.error || 'Mirroring stopped', error: true, retry: true });
        // Try again on its own a few times, e.g. after the device was unplugged and plugged back in.
        if (failures < MAX_AUTO_STARTS) {
          retryTimer = setTimeout(() => { if (!sessionId && target().online) start(); }, RETRY_MS);
        }
        break;
    }
  }

  function drawFrame(frame: VideoFrame): void {
    const w = frame.displayWidth, h = frame.displayHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      fit();
    }
    ctx ??= canvas.getContext('2d');
    ctx?.drawImage(frame, 0, 0);
    if (!showing()) {
      setShowing(true);
      failures = 0;
      setStatus({ text: '' });
      fit();
    }
  }

  /** Scales the canvas to fit the panel, keeping the device's aspect ratio. */
  function fit(): void {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    const sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
    const scale = Math.max(0.05, Math.min(sw / w, sh / h));
    canvas.style.width = Math.floor(w * scale) + 'px';
    canvas.style.height = Math.floor(h * scale) + 'px';
  }

  // (Re)start or stop as the target device changes or comes and goes.
  createEffect(on(target, (tg, prev) => {
    if (prev && tg.serial !== prev.serial) { failures = 0; stop(); }
    if (!tg.serial) { stop(); setStatus({ text: 'No device selected' }); return; }
    if (!tg.online) {
      if (!sessionId) setStatus({ text: 'Device is not connected' });
      return;
    }
    if (!sessionId && failures < MAX_AUTO_STARTS) start();
  }));

  function act(name: string): void {
    switch (name) {
      case 'power': press(send, KEY.POWER); break;
      case 'volup': press(send, KEY.VOLUME_UP); break;
      case 'voldown': press(send, KEY.VOLUME_DOWN); break;
      case 'rotate': send(simpleMessage(MSG.ROTATE)); break;
      case 'notifications': send(simpleMessage(MSG.EXPAND_NOTIFICATIONS)); break;
      case 'back': press(send, KEY.BACK); break;
      case 'home': press(send, KEY.HOME); break;
      case 'recents': press(send, KEY.APP_SWITCH); break;
      case 'restart': retry(); break;
    }
    input.focus({ preventScroll: true });
  }

  function onSplitterDown(ev: PointerEvent): void {
    ev.preventDefault();
    split.setPointerCapture(ev.pointerId);
    split.classList.add('dragging');
    const startX = ev.clientX;
    const startW = panel.getBoundingClientRect().width;
    const maxW = () => Math.max(260, (panel.parentElement?.clientWidth ?? 1200) - 420);
    const move = (e: PointerEvent) => {
      const w = Math.min(maxW(), Math.max(220, startW - (e.clientX - startX)));
      document.documentElement.style.setProperty('--mirror-w', Math.round(w) + 'px');
    };
    const end = () => {
      split.classList.remove('dragging');
      split.removeEventListener('pointermove', move);
      settings.mirrorWidth = Math.round(panel.getBoundingClientRect().width);
      saveSettings();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', end, { once: true });
  }

  onMount(() => {
    document.documentElement.style.setProperty('--mirror-w', settings.mirrorWidth + 'px');
    if (!listening) {
      listening = true;
      api.onMirror((id, event) => onMirrorEvent?.(id, event));
    }
    onMirrorEvent = (id, event) => { if (id === sessionId) onEvent(event); };
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    bindInput({
      canvas,
      input,
      stage,
      videoSize: () => ({ w: video.w || canvas.width, h: video.h || canvas.height }),
      send,
    });
    onCleanup(() => {
      ro.disconnect();
      onMirrorEvent = null;
      stop();
    });
  });

  const Btn = (props: { act: string; icon: string; title: string }) => (
    <button class="icon-btn small" title={props.title} onClick={() => act(props.act)}><Icon name={props.icon} /></button>
  );

  return (
    <>
      <div class="splitter" ref={split} onPointerDown={onSplitterDown} />
      <aside class="mirror" ref={panel}>
        <div class="mirror-bar">
          <span class="mirror-title" title={target().serial}>{target().label || deviceLabel() || 'No device'}</span>
          <span class="spacer" />
          <Btn act="power" icon="power" title="Power" />
          <Btn act="volup" icon="volup" title="Volume Up" />
          <Btn act="voldown" icon="voldown" title="Volume Down" />
          <Btn act="rotate" icon="rotate" title="Rotate" />
          <Btn act="notifications" icon="bell" title="Notifications" />
          <span class="tool-sep vertical" />
          <Btn act="back" icon="back" title="Back (right-click on screen)" />
          <Btn act="home" icon="home" title="Home (middle-click on screen)" />
          <Btn act="recents" icon="recents" title="Overview" />
          <span class="tool-sep vertical" />
          <Btn act="restart" icon="restart" title="Restart mirroring" />
          <button class="icon-btn small" title="Close" onClick={() => setMirrorOpen(false)}><Icon name="close" /></button>
        </div>
        <div class="mirror-stage" ref={stage}>
          <canvas id="mirrorCanvas" ref={canvas} hidden={!showing()} />
          <div class="mirror-status" classList={{ error: status().error }} hidden={!status().text}>
            {status().text}
            <Show when={status().retry}><br /><button onClick={retry}>Retry</button></Show>
          </div>
          <textarea class="mirror-input" ref={input} aria-label="Keyboard input for the device" spellcheck={false} autocomplete="off" />
        </div>
      </aside>
    </>
  );
}
