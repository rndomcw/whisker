'use strict';

// Screen mirroring through scrcpy's device-side server. We start scrcpy-server over adb, read its
// H.264 stream and pass packets to the renderer (which decodes them with WebCodecs), and relay
// input from the renderer to the server's control socket.
//
// Protocol (scrcpy 4.0, forward tunnel, audio off):
//   video socket: dummy byte, 64-byte device name, u32 codec id, then 12-byte headers, each either
//     a session packet  (u32 flags with bit 31 set, u32 width, u32 height) or
//     a media packet    (u64 pts|flags, u32 size) followed by `size` bytes.
//   control socket: opened second; the renderer builds the control messages.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { ADB, adb } = require('./adb');

const SCRCPY_VERSION = '4.0'; // must match vendor/scrcpy/scrcpy-server exactly
const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar';
const FLAG_SESSION = 1n << 63n;
const FLAG_CONFIG = 1n << 62n;
const FLAG_KEY_FRAME = 1n << 61n;
const PTS_MASK = FLAG_KEY_FRAME - 1n;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function serverFile() {
  const candidates = [
    process.env.SCRCPY_SERVER_PATH,
    process.resourcesPath && path.join(process.resourcesPath, 'scrcpy', 'scrcpy-server'), // packaged app
    path.join(__dirname, '..', 'vendor', 'scrcpy', 'scrcpy-server'),
  ];
  return candidates.find(p => p && fs.existsSync(p));
}

// Accumulates socket chunks so fixed-size fields can be read across chunk boundaries.
class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(buf) {
    this.chunks.push(buf);
    this.length += buf.length;
  }

  take(n) {
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k);
      off += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.length -= n;
    return out;
  }
}

class Mirror {
  // emit(type, payload): 'status' {text}, 'device' {name}, 'session' {width, height},
  // 'packet' {config, key, pts, data}, 'end' {error}
  constructor(serial, emit) {
    this.serial = serial;
    this.emit = emit;
    this.stopped = false;
    this.server = null;
    this.video = null;
    this.control = null;
    this.port = 0;
    this.serverLog = '';
  }

  async start({ maxSize = 1280, bitRate = 8000000, maxFps = 60 } = {}) {
    try {
      const file = serverFile();
      if (!file) throw new Error('scrcpy-server not found (expected in vendor/scrcpy)');
      this.emit('status', { text: 'Pushing scrcpy-server…' });
      await adb(['-s', this.serial, 'push', file, DEVICE_SERVER_PATH], 30000);
      if (this.stopped) return;

      const scid = Math.floor(Math.random() * 0x7fffffff);
      const socketName = 'scrcpy_' + scid.toString(16).padStart(8, '0');
      this.port = Number((await adb(['-s', this.serial, 'forward', 'tcp:0', 'localabstract:' + socketName])).trim());
      if (!this.port) throw new Error('adb forward failed');

      const args = [
        SCRCPY_VERSION, `scid=${scid.toString(16).padStart(8, '0')}`, 'log_level=info',
        'tunnel_forward=true', 'audio=false', 'control=true', 'cleanup=true', 'power_on=true',
        'clipboard_autosync=false', 'video_codec=h264', `max_size=${maxSize}`,
        `video_bit_rate=${bitRate}`, `max_fps=${maxFps}`,
      ];
      this.emit('status', { text: 'Starting scrcpy-server…' });
      this.server = spawn(ADB, ['-s', this.serial, 'shell',
        `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${args.join(' ')}`],
      { windowsHide: true });
      const onOutput = d => { this.serverLog = (this.serverLog + d).slice(-4000); };
      this.server.stdout.on('data', onOutput);
      this.server.stderr.on('data', onOutput);
      this.server.on('close', () => {
        this.server = null;
        this.fail(this.lastError() || 'scrcpy-server exited');
      });

      const { socket, first } = await this.connectVideo();
      this.video = socket;
      this.control = await this.connect();
      this.control.on('data', () => {}); // device messages (clipboard etc.) are not used; drain them
      this.control.on('error', () => {});
      this.readVideo(first.subarray(1)); // skip the dummy byte
    } catch (err) {
      this.fail(err.message);
    }
  }

  lastError() {
    const lines = this.serverLog.split(/\r?\n/).filter(l => /ERROR|Exception|does not match/.test(l));
    return lines.length ? lines[lines.length - 1].replace(/^\[server\]\s*/, '').trim() : '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.port, '127.0.0.1');
      s.once('connect', () => { s.removeListener('error', reject); resolve(s); });
      s.once('error', reject);
    });
  }

  // adb accepts the TCP connection before the server listens; the dummy byte tells us it's really up.
  async connectVideo() {
    for (let i = 0; i < 100 && !this.stopped; i++) {
      try {
        const s = await this.connect();
        const first = await new Promise(resolve => {
          s.once('data', d => { s.pause(); resolve(d); });
          s.once('close', () => resolve(null));
          s.once('error', () => resolve(null));
        });
        if (first && first.length) return { socket: s, first };
        s.destroy();
      } catch { /* not listening yet */ }
      await sleep(100);
    }
    throw new Error(this.lastError() || 'Could not connect to scrcpy-server');
  }

  readVideo(initial) {
    const q = new ByteQueue();
    let stage = 'device';
    let header = null;
    const pump = () => {
      for (;;) {
        if (stage === 'device') {
          if (q.length < 64) return;
          const name = q.take(64);
          this.emit('device', { name: name.subarray(0, name.indexOf(0) >= 0 ? name.indexOf(0) : 64).toString('utf8') });
          stage = 'codec';
        } else if (stage === 'codec') {
          if (q.length < 4) return;
          const codec = q.take(4).readUInt32BE(0);
          if (codec !== 0x68323634) { this.fail('Unexpected video codec'); return; } // "h264"
          stage = 'header';
        } else if (stage === 'header') {
          if (q.length < 12) return;
          header = q.take(12);
          const head = header.readBigUInt64BE(0);
          if (head & FLAG_SESSION) {
            this.emit('session', { width: header.readUInt32BE(4), height: header.readUInt32BE(8) });
          } else {
            stage = 'data';
          }
        } else {
          const size = header.readUInt32BE(8);
          if (q.length < size) return;
          const head = header.readBigUInt64BE(0);
          const config = !!(head & FLAG_CONFIG);
          this.emit('packet', {
            config,
            key: !config && !!(head & FLAG_KEY_FRAME),
            pts: config ? 0 : Number(head & PTS_MASK),
            data: q.take(size),
          });
          stage = 'header';
        }
      }
    };
    if (initial.length) q.push(initial);
    this.video.on('data', d => { q.push(d); pump(); });
    this.video.on('close', () => this.fail('Device disconnected'));
    this.video.on('error', () => {});
    this.video.resume();
    pump();
  }

  send(buf) {
    if (this.control && !this.control.destroyed) this.control.write(buf);
  }

  fail(error) {
    if (this.stopped) return;
    this.stop();
    this.emit('end', { error });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.video) this.video.destroy();
    if (this.control) this.control.destroy();
    if (this.server) this.server.kill();
    if (this.port) adb(['-s', this.serial, 'forward', '--remove', 'tcp:' + this.port]).catch(() => {});
  }
}

module.exports = { Mirror, SCRCPY_VERSION };
