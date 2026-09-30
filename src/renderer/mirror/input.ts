// Mouse, wheel and keyboard input on the mirrored screen, turned into control messages.

import {
  ACTION, backOrScreenOnMessages, KEY, keyMessage, pasteMessage, type Position, scrollMessage, textMessages, touchMessage,
} from './control';

/** Browser keys that map to Android key codes. */
const KEYMAP: Record<string, number> = {
  Enter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 111,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
  Home: 122, End: 123, PageUp: 92, PageDown: 93, Insert: 124,
};
const KEYCODE_A = 29;

export interface InputTarget {
  canvas: HTMLCanvasElement;
  /** Hidden textarea that receives keyboard and IME text. */
  input: HTMLTextAreaElement;
  stage: HTMLElement;
  /** Current video size, which touch coordinates must refer to. */
  videoSize(): { w: number; h: number };
  send(bytes: Uint8Array): void;
}

function metaState(ev: KeyboardEvent): number {
  return (ev.shiftKey ? 0x41 : 0) | (ev.ctrlKey ? 0x3000 : 0) | (ev.altKey ? 0x12 : 0);
}

const letterKeycode = (k: string) => KEYCODE_A + k.charCodeAt(0) - 97;

export function press(send: (b: Uint8Array) => void, keycode: number): void {
  send(keyMessage(ACTION.DOWN, keycode));
  send(keyMessage(ACTION.UP, keycode));
}

export function bindInput(target: InputTarget): void {
  const { canvas, input, stage, send } = target;
  let pointerDown = false;

  const position = (ev: MouseEvent): Position => {
    const r = canvas.getBoundingClientRect();
    const { w, h } = target.videoSize();
    const fx = Math.min(Math.max(ev.clientX - r.left, 0), r.width - 1) / r.width;
    const fy = Math.min(Math.max(ev.clientY - r.top, 0), r.height - 1) / r.height;
    return { x: Math.round(fx * w), y: Math.round(fy * h), w, h };
  };

  canvas.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    input.focus({ preventScroll: true });
    if (ev.button === 0) {
      pointerDown = true;
      canvas.setPointerCapture(ev.pointerId);
      send(touchMessage(ACTION.DOWN, position(ev)));
    } else if (ev.button === 1) {
      press(send, KEY.HOME);
    } else if (ev.button === 2) {
      for (const m of backOrScreenOnMessages()) send(m);
    }
  });
  canvas.addEventListener('pointermove', ev => { if (pointerDown) send(touchMessage(ACTION.MOVE, position(ev))); });
  const release = (ev: PointerEvent) => {
    if (!pointerDown) return;
    pointerDown = false;
    send(touchMessage(ACTION.UP, position(ev)));
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const perNotch = ev.deltaMode === 1 ? 3 : ev.deltaMode === 2 ? 0.1 : 100;
    send(scrollMessage(position(ev), -ev.deltaX / perNotch, -ev.deltaY / perNotch));
  }, { passive: false });

  input.addEventListener('focus', () => stage.classList.add('focused'));
  input.addEventListener('blur', () => stage.classList.remove('focused'));
  input.addEventListener('keydown', ev => {
    ev.stopPropagation(); // keep the app's shortcuts (Space = pause, …) out of device typing
    if (ev.isComposing || ev.keyCode === 229) return;
    const k = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && k === 'v') {
      ev.preventDefault();
      navigator.clipboard.readText().then(t => { if (t) send(pasteMessage(t)); }).catch(() => {});
      return;
    }
    const code = KEYMAP[ev.key];
    if (code !== undefined) {
      ev.preventDefault();
      send(keyMessage(ACTION.DOWN, code, metaState(ev), ev.repeat ? 1 : 0));
    } else if (mod && /^[a-z]$/.test(k)) {
      ev.preventDefault();
      send(keyMessage(ACTION.DOWN, letterKeycode(k), metaState(ev)));
    }
  });
  input.addEventListener('keyup', ev => {
    ev.stopPropagation();
    const k = ev.key.toLowerCase();
    const code = KEYMAP[ev.key];
    if (code !== undefined) send(keyMessage(ACTION.UP, code, metaState(ev)));
    else if ((ev.ctrlKey || ev.metaKey) && /^[a-z]$/.test(k) && k !== 'v') send(keyMessage(ACTION.UP, letterKeycode(k), metaState(ev)));
  });
  // Typed and IME-composed text arrives through the textarea's value.
  const flushText = () => {
    if (input.value) for (const m of textMessages(input.value)) send(m);
    input.value = '';
  };
  input.addEventListener('input', ev => { if (!(ev as InputEvent).isComposing) flushText(); });
  input.addEventListener('compositionend', flushText);
}
