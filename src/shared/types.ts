// Types shared by the main process, the preload bridge and the renderer.

/** The error message when adb can't be found. */
export const ADB_NOT_FOUND = 'adb not found';

/** Where to get adb: Google's SDK Platform-Tools. */
export const ADB_DOWNLOAD_URL = 'https://developer.android.com/tools/releases/platform-tools';

export interface DeviceList {
  devices: Device[];
  /** adb isn't installed, or wasn't found. */
  adbMissing: boolean;
}

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

/** Part of a recording to export, in ms from its start. */
export interface TrimRange {
  startMs: number;
  endMs: number;
}

export type RecordEvent =
  | { type: 'status'; text: string }
  /** The first frame arrived. */
  | { type: 'started'; width: number; height: number }
  | { type: 'progress'; durationMs: number; bytes: number }
  /** Recording stopped on its own (device unplugged, size change, time limit); call recordStop for the result. */
  | { type: 'end'; error: string };

export interface RecordingResult {
  /** The whole recording as MP4. */
  data: Uint8Array;
  durationMs: number;
  width: number;
  height: number;
}

export type MenuCommand =
  | 'newTab' | 'import' | 'save' | 'resetSettings'
  | 'toggleAutoSave' | 'chooseCaptureFolder' | 'openCaptureFolder'
  | 'about' | 'checkForUpdates';

/** Shown in the About dialog. */
export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  os: string;
  /** Running as the portable .exe (no automatic updates). */
  portable: boolean;
}

/** Where updates stand (see src/main/updater.ts). */
export type UpdateStatus =
  | { state: 'idle' }
  /** A development build, which doesn't update. */
  | { state: 'unsupported' }
  | { state: 'checking' }
  | { state: 'current'; checkedAt: number }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  /** A newer version for the portable app, to download by hand. */
  | { state: 'available'; version: string }
  | { state: 'error'; error: string };

/** Links the About dialog opens. */
export type AppLink = 'repo' | 'issues' | 'releases' | 'license';

/** Renderer settings shown in the application menu. */
export interface MenuState {
  autoSave: boolean;
  captureFolder: string;
}

/** The API the preload script exposes to the renderer as `window.whisker`. */
export interface WhiskerApi {
  platform: string;
  devices(): Promise<DeviceList>;
  /** Lets the user pick adb.exe; resolves with its path, or null if cancelled. Rejects if it isn't adb. */
  locateAdb(): Promise<string | null>;
  /** Opens the Platform-Tools download page in the browser. */
  openAdbDownload(): void;
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
  confirm(opts: ConfirmOptions): Promise<boolean>;

  /** PNG of the device screen. */
  captureScreenshot(serial: string): Promise<Uint8Array>;
  saveImage(png: Uint8Array, defaultName: string): Promise<string | null>;
  copyImage(png: Uint8Array): Promise<void>;
  recordStart(id: number, serial: string): void;
  /** Stops recording and returns the MP4, or null if nothing was captured. */
  recordStop(id: number): Promise<RecordingResult | null>;
  recordSave(id: number, range: TrimRange | null, defaultName: string): Promise<string | null>;
  /** Puts the (trimmed) MP4 on the clipboard as a file. */
  recordCopy(id: number, range: TrimRange | null): Promise<void>;
  /** Frees a finished recording. */
  recordDiscard(id: number): void;

  /** Default auto-save folder (Pictures\Whisker). */
  defaultCaptureFolder(): Promise<string>;
  /** Lets the user pick a folder; null if cancelled. */
  chooseFolder(current: string): Promise<string | null>;
  /** Captures a screenshot straight into `folder`; resolves with the file path. */
  saveScreenshotTo(serial: string, folder: string, baseName: string): Promise<string>;
  /** Writes the whole recording into `folder` and frees it; resolves with the file path. */
  recordSaveTo(id: number, folder: string, baseName: string): Promise<string>;
  showInFolder(filePath: string): void;
  openFolder(folder: string): void;
  onRecord(cb: (id: number, event: RecordEvent) => void): void;

  onMenu(cmd: MenuCommand, cb: () => void): void;
  /** Pops up the application menu at a point in the window (the menu bar is hidden on Windows/Linux). */
  showAppMenu(x: number, y: number): void;
  /** Updates the settings shown in the application menu. */
  setMenuState(state: MenuState): void;
  appInfo(): Promise<AppInfo>;
  updateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  checkForUpdates(): void;
  /** Restarts into a downloaded update; false while a recording would be lost. */
  installUpdate(): Promise<boolean>;
  openLink(link: AppLink): void;
  mirrorStart(id: number, serial: string, opts: MirrorOptions): void;
  mirrorStop(id: number): void;
  mirrorControl(id: number, data: Uint8Array): void;
  onMirror(cb: (id: number, event: MirrorEvent) => void): void;
}
