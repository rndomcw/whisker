// Types shared by the main process, the preload bridge and the renderer.

export interface Device {
  serial: string;
  /** adb state: "device", "offline", "unauthorized", … */
  state: string;
  model: string;
  product: string;
}

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  release: string;
  sdk: string;
}

/** `ps` output: pid → process name, plus the pids running as app users (u0_aNN). */
export interface ProcessList {
  procs: Record<string, string>;
  apps: string[];
}

/** A parsed threadtime line: [date (YYYY-MM-DD), time, pid, tid, level, tag, message]. */
export type ParsedLine = [date: string, time: string, pid: string, tid: string, level: string, tag: string, message: string];

/** Lines that don't parse (e.g. "--------- beginning of main") stay raw strings. */
export type LogLine = ParsedLine | string;

export interface StreamOptions {
  serial: string;
  buffer?: string;
  /** Resume from this timestamp (MM-DD hh:mm:ss.mmm) instead of showing recent history. */
  since?: string;
  /** Number of recent lines to show first. */
  tail?: number;
}

export interface StreamEnd {
  code?: number | null;
  error: string;
}

export interface MirrorOptions {
  maxSize?: number;
  bitRate?: number;
  maxFps?: number;
}

export type MirrorEvent =
  | { type: 'status'; text: string }
  | { type: 'device'; name: string }
  | { type: 'session'; width: number; height: number }
  | { type: 'packet'; config: boolean; key: boolean; pts: number; data: Uint8Array }
  | { type: 'end'; error: string };

export interface ConfirmOptions {
  message: string;
  detail?: string;
  /** Label of the confirming button. */
  ok?: string;
}

export interface ImportedLog {
  name: string;
  lines: LogLine[];
}

export type MenuCommand = 'newTab' | 'import' | 'save' | 'resetSettings';

/** The API the preload script exposes to the renderer as `window.whisker`. */
export interface WhiskerApi {
  platform: string;
  devices(): Promise<Device[]>;
  deviceInfo(serial: string): Promise<DeviceInfo>;
  procs(serial: string): Promise<ProcessList>;
  packages(serial: string): Promise<string[]>;
  clear(serial: string, buffer: string): Promise<void>;
  start(id: number, opts: StreamOptions): void;
  stop(id: number): void;
  onLines(cb: (id: number, batch: LogLine[]) => void): void;
  onEnd(cb: (id: number, info: StreamEnd) => void): void;
  saveFile(defaultName: string, text: string): Promise<string | null>;
  importFile(): Promise<ImportedLog | null>;
  screenshot(serial: string): Promise<string | null>;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  onMenu(cmd: MenuCommand, cb: () => void): void;
  mirrorStart(id: number, serial: string, opts: MirrorOptions): void;
  mirrorStop(id: number): void;
  mirrorControl(id: number, data: Uint8Array): void;
  onMirror(cb: (id: number, event: MirrorEvent) => void): void;
}
