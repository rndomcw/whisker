'use strict';

// Device mirroring panel. Shows the screen streamed by scrcpy-server (H.264, decoded with WebCodecs)
// and turns mouse, wheel and keyboard input into scrcpy 4.0 control messages.
const MirrorView = (() => {
  const api = window.logcat;
  const $ = id => document.getElementById(id);
  const els = {
    panel: $('mirror'), split: $('mirrorSplit'), title: $('mirrorTitle'), stage: $('mirrorStage'),
    canvas: $('mirrorCanvas'), status: $('mirrorStatus'), input: $('mirrorInput'),
  };
  const ctx = els.canvas.getContext('2d');

  // scrcpy control message types and Android constants
  const MSG = { KEYCODE: 0, TEXT: 1, TOUCH: 2, SCROLL: 3, BACK_OR_SCREEN_ON: 4, EXPAND_NOTIFICATIONS: 5, SET_CLIPBOARD: 9, ROTATE: 11, RESET_VIDEO: 17 };
  const DOWN = 0, UP = 1, MOVE = 2;
  const POINTER_FINGER = -2n; // scrcpy's "generic finger": injected as a touchscreen tap/swipe
  const KEY = { HOME: 3, BACK: 4, VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26, APP_SWITCH: 187 };
  const KEYMAP = {
    Enter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 111,
    ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
    Home: 122, End: 123, PageUp: 92, PageDown: 93, Insert: 124,
  };
  const TEXT_MAX = 300; // server limit per INJECT_TEXT message

  let open = false;
  let target = { serial: '', label: '', online: false };
  let id = 0;               // active mirror session (0 = none)
  let seq = 0;
  let failures = 0;         // consecutive failed starts; stops auto-retry after a few
  let session = { w: 0, h: 0 };
  let decoder = null;
  let codec = '';
  let configData = null;    // latest SPS/PPS, prepended to key frames
  let needKey = true;
  let lastReset = 0;
  let pointerDown = false;
  let hooks = { onClose() {}, onResize() {} };

  // ---------- status ----------

  function setStatus(text, { error = false, retry = false } = {}) {
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

  // ---------- session lifecycle ----------

  function start() {
    stop();
    if (!target.serial || !target.online) return;
    id = ++seq;
    session = { w: 0, h: 0 };
    configData = null;
    needKey = true;
    setStatus('Connecting…');
    api.mirrorStart(id, target.serial, { maxSize: 1280, bitRate: 8000000, maxFps: 60 });
  }

  function stop() {
    if (id) api.mirrorStop(id);
    id = 0;
    closeDecoder();
    els.canvas.hidden = true;
  }

  function update(next) {
    const changed = next.serial !== target.serial;
    target = next;
    els.title.textContent = target.label || 'No device';
    els.title.title = target.serial;
    if (!open) return;
    if (changed) { failures = 0; stop(); }
    if (!target.serial) { stop(); setStatus('No device selected'); return; }
    if (!target.online) {
      if (!id) setStatus('Device is not connected', { error: false });
      return;
    }
    if (!id && failures < 3) start();
  }

  function setOpen(v) {
    open = v;
    els.panel.hidden = !v;
    els.split.hidden = !v;
    if (v) { failures = 0; update(target); } else stop();
  }

  api.onMirror((mid, type, p) => {
    if (mid !== id) return;
    if (type === 'status') setStatus(p.text);
    else if (type === 'device') { if (!target.label) els.title.textContent = p.name; }
    else if (type === 'session') { session = { w: p.width, h: p.height }; fit(); }
    else if (type === 'packet') onPacket(p);
    else if (type === 'end') {
      id = 0;
      failures++;
      closeDecoder();
      els.canvas.hidden = true;
      setStatus(p.error || 'Mirroring stopped', { error: true, retry: true });
    }
  });

  // ---------- video ----------

  // WebCodecs needs "avc1.PPCCLL" (profile, constraints, level) from the SPS.
  function avcCodec(buf) {
    for (let i = 0; i + 6 < buf.length; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1 && (buf[i + 3] & 0x1f) === 7) {
        const hex = b => b.toString(16).padStart(2, '0');
        return 'avc1.' + hex(buf[i + 4]) + hex(buf[i + 5]) + hex(buf[i + 6]);
      }
    }
    return 'avc1.42001f';
  }

  function closeDecoder() {
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = null;
  }

  function configure(c) {
    closeDecoder();
    codec = c;
    decoder = new VideoDecoder({
      output: drawFrame,
      error: err => {
        console.warn('mirror decoder error', err);
        if (id) { configure(codec); requestKeyFrame(); }
      },
    });
    decoder.configure({ codec: c, optimizeForLatency: true });
    needKey = true;
  }

  // Ask the server to restart encoding, which sends a fresh config + key frame.
  function requestKeyFrame() {
    needKey = true;
    if (Date.now() - lastReset < 1000) return;
    lastReset = Date.now();
    send(new Uint8Array([MSG.RESET_VIDEO]));
  }

  function onPacket(p) {
    const data = p.data instanceof Uint8Array ? p.data : new Uint8Array(p.data);
    if (p.config) {
      const c = avcCodec(data);
      if (!decoder || decoder.state === 'closed' || c !== codec) configure(c);
      configData = data;
      needKey = true;
      return;
    }
    if (!decoder || decoder.state !== 'configured') return;
    if (needKey && !p.key) return;
    if (decoder.decodeQueueSize > 30) { requestKeyFrame(); return; } // falling behind: skip to a fresh key frame
    needKey = false;
    let chunk = data;
    if (p.key && configData) {
      chunk = new Uint8Array(configData.length + data.length);
      chunk.set(configData);
      chunk.set(data, configData.length);
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: p.pts, data: chunk }));
    } catch (err) {
      console.warn('mirror decode failed', err);
      requestKeyFrame();
    }
  }

  function drawFrame(frame) {
    const w = frame.displayWidth, h = frame.displayHeight;
    if (els.canvas.width !== w || els.canvas.height !== h) {
      els.canvas.width = w;
      els.canvas.height = h;
      fit();
    }
    ctx.drawImage(frame, 0, 0);
    frame.close();
    if (els.canvas.hidden) {
      els.canvas.hidden = false;
      failures = 0;
      setStatus('');
      fit();
    }
  }

  // Scale the canvas to fit the panel, keeping the device's aspect ratio.
  function fit() {
    const w = els.canvas.width, h = els.canvas.height;
    if (!w || !h) return;
    const sw = els.stage.clientWidth - 24, sh = els.stage.clientHeight - 24;
    const scale = Math.max(0.05, Math.min(sw / w, sh / h));
    els.canvas.style.width = Math.floor(w * scale) + 'px';
    els.canvas.style.height = Math.floor(h * scale) + 'px';
  }
  new ResizeObserver(fit).observe(els.stage);

  // ---------- control messages ----------

  function send(bytes) {
    if (id) api.mirrorControl(id, bytes);
  }

  function position(ev) {
    const r = els.canvas.getBoundingClientRect();
    const w = session.w || els.canvas.width, h = session.h || els.canvas.height;
    const fx = Math.min(Math.max(ev.clientX - r.left, 0), r.width - 1) / r.width;
    const fy = Math.min(Math.max(ev.clientY - r.top, 0), r.height - 1) / r.height;
    return { x: Math.round(fx * w), y: Math.round(fy * h), w, h };
  }

  function touch(action, ev) {
    const p = position(ev);
    const b = new DataView(new ArrayBuffer(32));
    b.setUint8(0, MSG.TOUCH);
    b.setUint8(1, action);
    b.setBigInt64(2, POINTER_FINGER);
    b.setInt32(10, p.x);
    b.setInt32(14, p.y);
    b.setUint16(18, p.w);
    b.setUint16(20, p.h);
    b.setUint16(22, action === UP ? 0 : 0xffff); // pressure, u16 fixed point
    b.setInt32(24, 0);                           // action button
    b.setInt32(28, 0);                           // buttons
    send(new Uint8Array(b.buffer));
  }

  function scroll(ev) {
    const p = position(ev);
    const perNotch = ev.deltaMode === 1 ? 3 : ev.deltaMode === 2 ? 0.1 : 100;
    // i16 fixed point of value / 16, as the server multiplies by 16
    const fixed = v => {
      const f = Math.max(-1, Math.min(1, v / 16));
      return f >= 1 ? 0x7fff : Math.round(f * 0x8000);
    };
    const b = new DataView(new ArrayBuffer(21));
    b.setUint8(0, MSG.SCROLL);
    b.setInt32(1, p.x);
    b.setInt32(5, p.y);
    b.setUint16(9, p.w);
    b.setUint16(11, p.h);
    b.setInt16(13, fixed(-ev.deltaX / perNotch));
    b.setInt16(15, fixed(-ev.deltaY / perNotch));
    b.setInt32(17, 0);
    send(new Uint8Array(b.buffer));
  }

  function key(action, keycode, meta = 0, repeat = 0) {
    const b = new DataView(new ArrayBuffer(14));
    b.setUint8(0, MSG.KEYCODE);
    b.setUint8(1, action);
    b.setInt32(2, keycode);
    b.setInt32(6, repeat);
    b.setInt32(10, meta);
    send(new Uint8Array(b.buffer));
  }

  function press(keycode) {
    key(DOWN, keycode);
    key(UP, keycode);
  }

  function withString(prefix, str) {
    const u = new TextEncoder().encode(str);
    const b = new Uint8Array(prefix.length + 4 + u.length);
    b.set(prefix);
    new DataView(b.buffer).setUint32(prefix.length, u.length);
    b.set(u, prefix.length + 4);
    return b;
  }

  function text(str) {
    const chars = [...str];
    for (let i = 0; i < chars.length; i += TEXT_MAX) {
      send(withString([MSG.TEXT], chars.slice(i, i + TEXT_MAX).join('')));
    }
  }

  // Put text on the device clipboard and paste it (works for any language, unlike key injection).
  function pasteText(str) {
    // type, u64 sequence (0 = no ack), paste flag
    send(withString([MSG.SET_CLIPBOARD, 0, 0, 0, 0, 0, 0, 0, 0, 1], str));
  }

  function backOrScreenOn() {
    send(new Uint8Array([MSG.BACK_OR_SCREEN_ON, DOWN]));
    send(new Uint8Array([MSG.BACK_OR_SCREEN_ON, UP]));
  }

  function metaState(ev) {
    return (ev.shiftKey ? 0x41 : 0) | (ev.ctrlKey ? 0x3000 : 0) | (ev.altKey ? 0x12 : 0);
  }

  // ---------- input ----------

  els.canvas.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    els.input.focus({ preventScroll: true });
    if (ev.button === 0) {
      pointerDown = true;
      els.canvas.setPointerCapture(ev.pointerId);
      touch(DOWN, ev);
    } else if (ev.button === 1) {
      press(KEY.HOME);
    } else if (ev.button === 2) {
      backOrScreenOn();
    }
  });
  els.canvas.addEventListener('pointermove', ev => { if (pointerDown) touch(MOVE, ev); });
  const release = ev => {
    if (!pointerDown) return;
    pointerDown = false;
    touch(UP, ev);
  };
  els.canvas.addEventListener('pointerup', release);
  els.canvas.addEventListener('pointercancel', release);
  els.canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  els.canvas.addEventListener('wheel', ev => { ev.preventDefault(); scroll(ev); }, { passive: false });

  // Keyboard goes through a hidden textarea so IME input (e.g. Chinese) arrives as composed text.
  els.input.addEventListener('focus', () => els.stage.classList.add('focused'));
  els.input.addEventListener('blur', () => els.stage.classList.remove('focused'));
  els.input.addEventListener('keydown', ev => {
    ev.stopPropagation(); // keep the app's shortcuts (Space = pause, …) out of device typing
    if (ev.isComposing || ev.keyCode === 229) return;
    const k = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && k === 'v') {
      ev.preventDefault();
      navigator.clipboard.readText().then(t => { if (t) pasteText(t); }).catch(() => {});
      return;
    }
    const code = KEYMAP[ev.key];
    if (code !== undefined) {
      ev.preventDefault();
      key(DOWN, code, metaState(ev), ev.repeat ? 1 : 0);
    } else if (mod && /^[a-z]$/.test(k)) {
      ev.preventDefault();
      key(DOWN, 29 + k.charCodeAt(0) - 97, metaState(ev)); // KEYCODE_A = 29
    }
  });
  els.input.addEventListener('keyup', ev => {
    ev.stopPropagation();
    const k = ev.key.toLowerCase();
    const code = KEYMAP[ev.key];
    if (code !== undefined) key(UP, code, metaState(ev));
    else if ((ev.ctrlKey || ev.metaKey) && /^[a-z]$/.test(k) && k !== 'v') key(UP, 29 + k.charCodeAt(0) - 97, metaState(ev));
  });
  const flushText = () => {
    if (els.input.value) text(els.input.value);
    els.input.value = '';
  };
  els.input.addEventListener('input', ev => { if (!ev.isComposing) flushText(); });
  els.input.addEventListener('compositionend', flushText);

  // ---------- panel toolbar ----------

  els.panel.querySelector('.mirror-bar').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'power': press(KEY.POWER); break;
      case 'volup': press(KEY.VOLUME_UP); break;
      case 'voldown': press(KEY.VOLUME_DOWN); break;
      case 'rotate': send(new Uint8Array([MSG.ROTATE])); break;
      case 'notifications': send(new Uint8Array([MSG.EXPAND_NOTIFICATIONS])); break;
      case 'back': press(KEY.BACK); break;
      case 'home': press(KEY.HOME); break;
      case 'recents': press(KEY.APP_SWITCH); break;
      case 'restart': failures = 0; start(); break;
      case 'close': setOpen(false); hooks.onClose(); break;
    }
    if (btn.dataset.act !== 'close') els.input.focus({ preventScroll: true });
  });

  // ---------- resizing ----------

  function setWidth(w) {
    document.documentElement.style.setProperty('--mirror-w', Math.round(w) + 'px');
  }

  els.split.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    els.split.setPointerCapture(ev.pointerId);
    els.split.classList.add('dragging');
    const startX = ev.clientX;
    const startW = els.panel.getBoundingClientRect().width;
    const maxW = () => Math.max(260, els.panel.parentElement.clientWidth - 420);
    const move = e => setWidth(Math.min(maxW(), Math.max(220, startW - (e.clientX - startX))));
    const end = () => {
      els.split.classList.remove('dragging');
      els.split.removeEventListener('pointermove', move);
      hooks.onResize(els.panel.getBoundingClientRect().width);
    };
    els.split.addEventListener('pointermove', move);
    els.split.addEventListener('pointerup', end, { once: true });
  });

  return {
    init(opts) {
      hooks = { ...hooks, ...opts };
      if (opts.width) setWidth(opts.width);
    },
    setOpen,
    isOpen: () => open,
    update,
  };
})();
