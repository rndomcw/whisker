// Screen mirroring through scrcpy's device-side server. We start scrcpy-server over adb, read its
// H.264 stream and pass packets to the renderer (which decodes them with WebCodecs), and relay
// input from the renderer to the server's control socket.

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app } from 'electron';
import type { MirrorEvent, MirrorOptions } from '../../shared/types';
import { ADB, runAdb } from '../adb/adb';
import { ByteQueue } from './byteQueue';
import {
  CODEC_H264, DEVICE_NAME_LENGTH, DEVICE_SERVER_PATH, FLAG_CONFIG, FLAG_KEY_FRAME, FLAG_SESSION, HEADER_LENGTH,
  PTS_MASK, SCRCPY_VERSION,
} from './protocol';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function serverFile(): string | undefined {
  const candidates = [
    process.env.SCRCPY_SERVER_PATH,
    path.join(process.resourcesPath, 'scrcpy', 'scrcpy-server'),         // packaged app
    path.join(app.getAppPath(), 'vendor', 'scrcpy', 'scrcpy-server'),    // development
  ];
  return candidates.find((p): p is string => !!p && fs.existsSync(p));
}

export class MirrorSession {
  private stopped = false;
  private server: ChildProcess | null = null;
  private video: net.Socket | null = null;
  private control: net.Socket | null = null;
  private port = 0;
  private serverLog = '';

  constructor(private readonly serial: string, private readonly emit: (event: MirrorEvent) => void) {}

  async start({ maxSize = 1280, bitRate = 8000000, maxFps = 60 }: MirrorOptions = {}): Promise<void> {
    try {
      const file = serverFile();
      if (!file) throw new Error('scrcpy-server not found (expected in vendor/scrcpy)');
      this.emit({ type: 'status', text: 'Pushing scrcpy-server…' });
      await runAdb(['-s', this.serial, 'push', file, DEVICE_SERVER_PATH], 30000);
      if (this.stopped) return;

      const scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0');
      this.port = Number((await runAdb(['-s', this.serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`])).trim());
      if (!this.port) throw new Error('adb forward failed');

      const args = [
        SCRCPY_VERSION, `scid=${scid}`, 'log_level=info',
        'tunnel_forward=true', 'audio=false', 'control=true', 'cleanup=true', 'power_on=true',
        'clipboard_autosync=false', 'video_codec=h264', `max_size=${maxSize}`,
        `video_bit_rate=${bitRate}`, `max_fps=${maxFps}`,
      ];
      this.emit({ type: 'status', text: 'Starting scrcpy-server…' });
      const server = spawn(ADB, ['-s', this.serial, 'shell',
        `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${args.join(' ')}`],
      { windowsHide: true });
      this.server = server;
      const onOutput = (d: Buffer) => { this.serverLog = (this.serverLog + d.toString()).slice(-4000); };
      server.stdout.on('data', onOutput);
      server.stderr.on('data', onOutput);
      server.on('close', () => {
        this.server = null;
        this.fail(this.lastError() || 'scrcpy-server exited');
      });

      const { socket, first } = await this.connectVideo();
      this.video = socket;
      this.control = await this.connect();
      this.control.on('data', () => {}); // device messages (clipboard etc.) are not used; drain them
      this.control.on('error', () => {});
      this.readVideo(socket, first.subarray(1)); // skip the dummy byte
    } catch (err) {
      this.fail((err as Error).message);
    }
  }

  send(buf: Buffer): void {
    if (this.control && !this.control.destroyed) this.control.write(buf);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.video?.destroy();
    this.control?.destroy();
    this.server?.kill();
    if (this.port) runAdb(['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`]).catch(() => {});
  }

  private fail(error: string): void {
    if (this.stopped) return;
    this.stop();
    this.emit({ type: 'end', error });
  }

  private lastError(): string {
    const lines = this.serverLog.split(/\r?\n/).filter(l => /ERROR|Exception|does not match/.test(l));
    return lines.length ? lines[lines.length - 1].replace(/^\[server\]\s*/, '').trim() : '';
  }

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.port, '127.0.0.1');
      s.once('connect', () => { s.removeListener('error', reject); resolve(s); });
      s.once('error', reject);
    });
  }

  // adb accepts the TCP connection before the server listens; the dummy byte tells us it's really up.
  private async connectVideo(): Promise<{ socket: net.Socket; first: Buffer }> {
    for (let i = 0; i < 100 && !this.stopped; i++) {
      try {
        const s = await this.connect();
        const first = await new Promise<Buffer | null>(resolve => {
          s.once('data', (d: Buffer) => { s.pause(); resolve(d); });
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

  private readVideo(socket: net.Socket, initial: Buffer): void {
    const q = new ByteQueue();
    let stage: 'device' | 'codec' | 'header' | 'data' = 'device';
    let header: Buffer = Buffer.alloc(0);

    const pump = () => {
      for (;;) {
        if (stage === 'device') {
          if (q.length < DEVICE_NAME_LENGTH) return;
          const name = q.take(DEVICE_NAME_LENGTH);
          const end = name.indexOf(0);
          this.emit({ type: 'device', name: name.subarray(0, end >= 0 ? end : DEVICE_NAME_LENGTH).toString('utf8') });
          stage = 'codec';
        } else if (stage === 'codec') {
          if (q.length < 4) return;
          if (q.take(4).readUInt32BE(0) !== CODEC_H264) { this.fail('Unexpected video codec'); return; }
          stage = 'header';
        } else if (stage === 'header') {
          if (q.length < HEADER_LENGTH) return;
          header = q.take(HEADER_LENGTH);
          if (header.readBigUInt64BE(0) & FLAG_SESSION) {
            this.emit({ type: 'session', width: header.readUInt32BE(4), height: header.readUInt32BE(8) });
          } else {
            stage = 'data';
          }
        } else {
          const size = header.readUInt32BE(8);
          if (q.length < size) return;
          const head = header.readBigUInt64BE(0);
          const config = !!(head & FLAG_CONFIG);
          this.emit({
            type: 'packet',
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
    socket.on('data', (d: Buffer) => { q.push(d); pump(); });
    socket.on('close', () => this.fail('Device disconnected'));
    socket.on('error', () => {});
    socket.resume();
    pump();
  }
}
