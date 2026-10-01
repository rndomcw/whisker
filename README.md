# Whisker

Whisker is a desktop Android logcat viewer with device mirroring (Electron), modeled on Android Studio's Logcat panel, so you can debug your app without opening Android Studio.

## Develop

Whisker is written in TypeScript. esbuild bundles it into `out/`, and `tsc` checks the types.

```bash
npm install
npm start
```

| Command | What it does |
| --- | --- |
| `npm start` | Builds into `out/` and starts the app |
| `npm run watch` | Rebuilds on every change; restart the app, or press `Ctrl+R` for renderer changes |
| `npm run typecheck` | Type-checks the main process and the renderer separately |
| `npm run build` | Bundles `src/` into `out/` |

If `npm start` reports that Electron failed to install, run `node node_modules/electron/install.js` to download the Electron binary.

## Build

```bash
npm run dist
```

This type-checks, bundles and writes an installer and a portable `.exe` to `dist/`. `npm run pack` builds only the unpacked app, in `dist/win-unpacked/`, which is faster to test.

The app icon is drawn in `build/icon.svg`. After editing it, run `npm run icon` to regenerate `build/icon.png` and `build/icon.ico`.

adb is found through the `ADB` environment variable, then `ANDROID_HOME` or `ANDROID_SDK_ROOT`, then the default SDK location (`%LOCALAPPDATA%\Android\Sdk`), and finally `PATH`.

## Layout

```
src/
  shared/          Types and IPC channel names used by both processes
  main/            Electron main process
    main.ts          App lifecycle
    window.ts        Main window and title bar
    menu.ts          Menu and keyboard accelerators
    ipc/             IPC handlers behind window.whisker, one file per area (adb, mirror, files, capture)
    sessions.ts      Per-window logcat streams, mirror sessions and recordings, cleaned up on reload/close
    migrate.ts       Copies settings from the old "Logcat Viewer" name
    adb/             Finding/running adb, device queries, logcat streaming and parsing
    mirror/          scrcpy-server session: protocol constants, stream reader
    capture/         Screen recording, MP4 muxer (H.264, edit-list trimming), clipboard helpers
  preload/         Exposes the typed window.whisker API
  renderer/        The UI
    main.ts          Entry point: initializes the modules and starts polling
    tabs/            Tab (lines, filters, streaming), tab strip, stream routing
    query/           Filter query tokenizer and compiler (Android Studio syntax)
    log/             Log entry model and package/process selections
    view/            Virtualized rendering, row layout, hover, status messages
    ui/              Device/process pickers, query bar, autocomplete, toolbar, menus, keyboard
    mirror/          Mirror panel: WebCodecs decoding, input, control messages
    capture/         Screenshot editor, recording preview/trim, REC badge, modal dialog
    styles/          CSS, split by area
scripts/           build.mjs (esbuild) and make-icon.js
vendor/scrcpy/     Bundled scrcpy-server v4.0 and its Apache-2.0 license
build/             App icon
```

## Features

- **Studio layout**
  - **Menu:** the ☰ button at the top left (or pressing `Alt`) opens the File, Capture and View menus: new tab, import/export, reset settings, auto-save and its folder, reload, DevTools, zoom and full screen. On macOS they are in the menu bar at the top of the screen.
  - **Tabs:** each tab has its own device and filter. `+` or `Ctrl+T` adds a tab; double-click a tab to rename it; middle-click closes it.
  - **Device picker** in the "Castles S1U2-M4 (serial) Android 13, API 33" style. It notices devices being plugged in or removed and reconnects on its own, without repeating lines.
  - **Columns:** date and time, PID-TID, a tag colored per tag, package, a level badge, and the message colored by level.
  - **Process markers:** `PROCESS STARTED` and `PROCESS ENDED` lines, as Studio shows them.
- **Package/process dropdown** next to the device picker. It lists running apps with their PIDs, apps that have stopped, installed apps (`package:mine`) and system processes, with a search box.
  - It supports **multiple selection**: click or press Enter to check several items; the menu stays open. Checked items are listed under *Selected* at the top, and lines from any of them are shown.
  - It matches by name, so the view keeps following your app across restarts and new PIDs.
  - If the app isn't running, the view waits for it to start. Type a package that hasn't started yet and press Enter to wait for it.
  - It combines with the filter bar. The choice is saved per tab, and right-clicking a line offers **Show only package: …**.
- **Filter bar with Studio's query syntax** (click `?` in the app for the full reference):
  - `tag:`, `package:`, `process:`, `message:`, `line:`, with `=:` for an exact match and `~:` for a regex.
  - `-key:` excludes; `level:`, `age:5m`, `is:crash` and `is:stacktrace` are also supported.
  - Free text, `|`, `&`, parentheses and quoted values work too.
  - `package:mine` matches the third-party apps installed on the device.
  - `Ctrl+Space` shows suggestions: keys, running packages and processes, seen tags, and levels.
  - Filters can be saved as favorites (☆). The funnel icon lists favorites and filter history. `Cc` makes matching case-sensitive.
- **Side toolbar**
  - Log controls: Clear (also clears the device's log buffer), Pause, Restart, Scroll to End, and Previous/Next Error.
  - Soft-Wrap.
  - Import: opens a log file in a new tab.
  - Export: writes the filtered lines to a file.
  - Formatting: Standard or Compact view, column toggles, the log buffer, and **Reset All Settings…**.
    Settings (tabs, filters, favorites, display options, mirror panel) are remembered between launches in `%APPDATA%\Whisker`; reset returns them to the defaults. Settings from the earlier "Logcat Viewer" name are copied over on first launch.
  - **Take Screenshot** opens a preview where you can edit the image before copying or saving it:
    - rotate and crop;
    - annotate with pen, arrow, rectangle and text in six colors;
    - **pixelate** areas to hide sensitive data such as card numbers;
    - undo/redo, and recapture.
    Shortcuts: `C` `P` `A` `R` `T` `X` pick a tool; `Ctrl+Z`/`Ctrl+Y` undo/redo; `Ctrl+C` copies and `Ctrl+S` saves.
  - **Record Screen** starts recording; a REC badge shows the time and size, and the button or badge stops it.
    - A preview then plays the video. Drag the handles on the timeline to trim it; *Play Selection* plays the trimmed part.
    - **Copy to Clipboard** copies the MP4 file, so you can paste it into Explorer, Teams, Slack, and so on. **Save…** writes it.
    - Recordings use the bundled scrcpy at the device's resolution (video only, up to 30 minutes).
    - They are written as MP4 directly, without re-encoding; trimming uses an MP4 edit list, so it is frame-accurate.
    - Rotating the device ends a recording, because one MP4 track can't change size.
  - **Auto-save:** use the ☰ menu's **Capture** menu, or right-click the screenshot or record button.
    - With **Auto-save Captures** on, captures skip the preview and go straight to the auto-save folder (default `Pictures\Whisker`), so you can take screenshots back to back.
    - The buttons' tooltips show where captures go, and each save shows a *Show in Folder* link.
    - Files taken in the same second get `-2`, `-3`, … suffixes instead of overwriting each other.
- **Device mirroring**: the phone button at the bottom of the left toolbar opens a screen panel, like Android Studio's Running Devices. It uses the bundled [scrcpy](https://github.com/Genymobile/scrcpy) v4.0 server (`vendor/scrcpy`); scrcpy doesn't need to be installed.
  - Mouse: click or drag to tap or swipe. The wheel scrolls, right-click is Back, and middle-click is Home.
  - Keyboard: click the screen, then type. Chinese IME input works, and `Ctrl+V` pastes the PC clipboard into the device.
  - Panel buttons: Power, Volume, Rotate, Notifications, Back, Home, Overview and Restart. Drag the divider to resize the panel.
  - The panel follows the active tab's device.
- **Right-click a line** to copy it, copy just the message, or filter or exclude its tag or package.
  - **Exclude message** hides every line with the same message. It matches the text before the first number, so lines that differ only in counters are hidden too.
- Terminal color codes that some SDKs put in log messages (`[093m … [0m`) are removed.
- **Selecting lines:** click, Shift-click and Ctrl-click, then `Ctrl+C` to copy.
- **Performance:** keeps the most recent 200k lines per tab and only draws the rows on screen.

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+F` | Focus filter |
| `Ctrl+Space` | Filter suggestions |
| `Ctrl+T` | New tab |
| `Ctrl+O` / `Ctrl+S` | Import / export log |
| `Space` | Pause / resume |
| `End` / `Home` | Jump to newest / oldest |
| `Ctrl+A`, `Ctrl+C` | Select all shown lines, copy selection |
| `Esc` | Clear selection / close popup |
