# Contributing to Whisker

Thanks for helping out! Bug reports, feature ideas and pull requests are all welcome.

- **Bugs:** open an issue with your Windows version, your device model and Android version, what you did, and what happened. A screenshot or an exported log (`Ctrl+S`) helps a lot. Remove anything private from it first.
- **Features:** open an issue first for anything large, so we can agree on the approach before you write it.
- **Pull requests:** keep them focused, run `npm run typecheck` before sending, and describe how you tested the change.

## Development setup

You need [Node.js](https://nodejs.org/) 22 or later and adb (see [Requirements](README.md#requirements)).

```bash
npm install
npm start
```

If `npm start` reports that Electron failed to install, run `node node_modules/electron/install.js` to download the Electron binary.

| Command | What it does |
| --- | --- |
| `npm start` | Builds into `out/` and starts the app |
| `npm run watch` | Rebuilds on every change; restart the app, or press `Ctrl+R` for renderer changes |
| `npm run typecheck` | Type-checks the main process and the renderer separately |
| `npm run build` | Bundles `src/` into `out/` |
| `npm run pack` | Builds the unpacked app in `dist/win-unpacked/`, which is quick to test |
| `npm run dist` | Type-checks, bundles, and writes the installer and the portable `.exe` to `dist/` |
| `npm run icon` | Regenerates `build/icon.png` and `build/icon.ico` from `build/icon.svg` |

Whisker is written in strict TypeScript. esbuild bundles it, and `tsc` only checks types.

## Project layout

```
src/
  shared/          Types and IPC channel names used by both processes
  main/            Electron main process
    main.ts          App lifecycle
    window.ts        Main window and title bar
    menu.ts          Application menu (popped up from the Whisker logo) and keyboard accelerators
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
    view/            Virtualized rendering, row layout, hover, find, status messages
    ui/              Pickers, query bar, find bar, autocomplete, toolbar, menus, keyboard
    mirror/          Mirror panel: WebCodecs decoding, input, control messages
    capture/         Screenshot editor, recording preview/trim, REC badge, modal dialog
    styles/          CSS, split by area
scripts/           build.mjs (esbuild) and make-icon.js
vendor/scrcpy/     Bundled scrcpy-server v4.0 and its Apache-2.0 license
build/             App icon
docs/images/       README screenshots (made from a fictional log, not a real device)
```

## How it works

- **Logs:** the main process runs `adb logcat -v threadtime` and sends parsed lines to the renderer in batches. After a reconnect, it resumes with `-T <last timestamp>` and drops lines it already has.
- **Rendering:** the log view is virtualized. Only the rows on screen are in the DOM, so a tab can hold 200k lines.
- **Mirroring and recording:** Whisker pushes the bundled `scrcpy-server` to the device and reads its H.264 stream through an adb forward tunnel.
  - Mirroring decodes the stream in the renderer with WebCodecs and sends input back over scrcpy's control socket.
  - Recording muxes the same stream into MP4 in the main process, so ffmpeg isn't needed.

## Screenshots in the README

Please don't commit screenshots of real devices or real app logs, because they can contain serial numbers, account IDs or other private data. The images in `docs/images/` were made by importing a made-up log file.
