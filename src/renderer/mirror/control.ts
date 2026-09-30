// Encoders for scrcpy 4.0 control messages (big-endian, see the server's ControlMessageReader).

export const MSG = {
  KEYCODE: 0,
  TEXT: 1,
  TOUCH: 2,
  SCROLL: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATIONS: 5,
  SET_CLIPBOARD: 9,
  ROTATE: 11,
  RESET_VIDEO: 17,
} as const;

export const ACTION = { DOWN: 0, UP: 1, MOVE: 2 } as const;

/** Android key codes used by the panel buttons. */
export const KEY = { HOME: 3, BACK: 4, VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26, APP_SWITCH: 187 } as const;

/** scrcpy's "generic finger": injected as a touchscreen tap/swipe. */
const POINTER_FINGER = -2n;

/** Max characters per INJECT_TEXT message (server limit). */
const TEXT_MAX = 300;

/** A point on the device screen, with the video size it refers to (must match the current session). */
export interface Position {
  x: number;
  y: number;
  w: number;
  h: number;
}

const bytes = (view: DataView) => new Uint8Array(view.buffer);

function writePosition(b: DataView, offset: number, p: Position): void {
  b.setInt32(offset, p.x);
  b.setInt32(offset + 4, p.y);
  b.setUint16(offset + 8, p.w);
  b.setUint16(offset + 10, p.h);
}

export function touchMessage(action: number, p: Position): Uint8Array {
  const b = new DataView(new ArrayBuffer(32));
  b.setUint8(0, MSG.TOUCH);
  b.setUint8(1, action);
  b.setBigInt64(2, POINTER_FINGER);
  writePosition(b, 10, p);
  b.setUint16(22, action === ACTION.UP ? 0 : 0xffff); // pressure, u16 fixed point
  b.setInt32(24, 0);                                  // action button
  b.setInt32(28, 0);                                  // buttons
  return bytes(b);
}

/** hScroll/vScroll in wheel notches (positive = left/up). */
export function scrollMessage(p: Position, hScroll: number, vScroll: number): Uint8Array {
  // i16 fixed point of value / 16, as the server multiplies by 16
  const fixed = (v: number) => {
    const f = Math.max(-1, Math.min(1, v / 16));
    return f >= 1 ? 0x7fff : Math.round(f * 0x8000);
  };
  const b = new DataView(new ArrayBuffer(21));
  b.setUint8(0, MSG.SCROLL);
  writePosition(b, 1, p);
  b.setInt16(13, fixed(hScroll));
  b.setInt16(15, fixed(vScroll));
  b.setInt32(17, 0);
  return bytes(b);
}

export function keyMessage(action: number, keycode: number, meta = 0, repeat = 0): Uint8Array {
  const b = new DataView(new ArrayBuffer(14));
  b.setUint8(0, MSG.KEYCODE);
  b.setUint8(1, action);
  b.setInt32(2, keycode);
  b.setInt32(6, repeat);
  b.setInt32(10, meta);
  return bytes(b);
}

function withString(prefix: number[], str: string): Uint8Array {
  const u = new TextEncoder().encode(str);
  const b = new Uint8Array(prefix.length + 4 + u.length);
  b.set(prefix);
  new DataView(b.buffer).setUint32(prefix.length, u.length);
  b.set(u, prefix.length + 4);
  return b;
}

/** INJECT_TEXT messages, split to respect the server's length limit. */
export function textMessages(str: string): Uint8Array[] {
  const chars = [...str];
  const out: Uint8Array[] = [];
  for (let i = 0; i < chars.length; i += TEXT_MAX) out.push(withString([MSG.TEXT], chars.slice(i, i + TEXT_MAX).join('')));
  return out;
}

/** Puts text on the device clipboard and pastes it (works for any language, unlike key injection). */
export function pasteMessage(str: string): Uint8Array {
  // type, u64 sequence (0 = no ack), paste flag
  return withString([MSG.SET_CLIPBOARD, 0, 0, 0, 0, 0, 0, 0, 0, 1], str);
}

export function backOrScreenOnMessages(): Uint8Array[] {
  return [new Uint8Array([MSG.BACK_OR_SCREEN_ON, ACTION.DOWN]), new Uint8Array([MSG.BACK_OR_SCREEN_ON, ACTION.UP])];
}

/** Messages that are just their type byte. */
export function simpleMessage(type: number): Uint8Array {
  return new Uint8Array([type]);
}
