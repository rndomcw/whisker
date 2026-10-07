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

Whisker is written in strict TypeScript; the UI uses [SolidJS](https://www.solidjs.com/) and [Tailwind CSS](https://tailwindcss.com/) v4. esbuild bundles the code (with `esbuild-plugin-solid` for the JSX), the Tailwind CLI builds the CSS, and `tsc` only checks types.

## Styling

- **Components use Tailwind utilities.** The theme colors are named after the CSS variables in `styles/theme.css` (`bg-panel`, `text-dim`, `border-line`, `bg-accent`, …), and they follow the light/dark system theme.
- **Shared controls live in `components/ui.tsx`**: `IconButton`, `Separator`, `TextToggle`, and the class lists for menus, pickers and text buttons. Use them instead of copying class lists.
- **Pick one value per property.** For a state, choose between two class lists (`on ? 'bg-press text-fg' : 'text-icon hover:bg-hover'`) instead of adding an override. When two utilities set the same property on one element, the order in the stylesheet decides, not the order in `class`.
- **Write class names in full.** Tailwind finds classes by scanning the source, so a class name assembled from parts (such as `'text-' + color`) isn't generated.
- **Some styles stay CSS** (`styles/`), because they're clearer that way:
  - `log.css`: the log rows. A row's level class colors its message and badge, and a class on `#log` hides columns or turns on wrapping for every row at once.
  - `app.css`: the title bar's window-drag area, and states set from code (the record icon, the focused mirror screen).
  - `base.css`: element defaults. Tailwind's preflight reset isn't used.

## Naming

- **Files** are named after what they export:
  - A Solid component (`.tsx`) or a class uses PascalCase, matching its name: `LogView.tsx`, `Tab.ts` (`class Tab`), `MirrorSession.ts`.
  - Any other module (functions, constants, state) uses camelCase: `rowMenu.ts`, `tabActions.ts`, `settings.ts`.
- **Folders** are lowercase: `state/`, `components/`, `mirror/`.

## Project layout

```
src/
  shared/          Types and IPC channel names used by both processes
  main/            Electron main process
    main.ts          App lifecycle
    window.ts        Main window and title bar
    menu.ts          Application menu (popped up from the Whisker logo) and keyboard accelerators
    updater.ts       Updates from GitHub Releases (electron-updater); the About dialog shows their status
    ipc/             IPC handlers behind window.whisker, one file per area (adb, mirror, files, capture, app)
    sessions.ts      Per-window logcat streams, mirror sessions and recordings, cleaned up on reload/close
    adb/             Finding/running adb, device queries, logcat streaming and parsing
    mirror/          scrcpy-server session: protocol constants, stream reader
    capture/         Screen recording, MP4 muxer (H.264, edit-list trimming), clipboard helpers
  preload/         Exposes the typed window.whisker API
  renderer/        The UI, built with SolidJS
    main.tsx         Entry point: restores the tabs, renders <App>, starts polling devices
    state/           Reactive app state: tabs (Tab.ts), devices, settings, filter query, find, menus,
                     dialogs, toasts, recording and capture settings
    components/      Solid components
      App.tsx          Window layout and the popups over it
      header/          Logo (opens the app menu) and tab strip
      filter/          Device and process pickers, query box with suggestions and syntax help
      log/             Virtualized log view, find bar, notice/empty messages, row menu, log actions
      mirror/          Mirror panel
      capture/         Screenshot editor and dialog, recording preview and trim, REC badge
      Toolbar.tsx      Left toolbar and the commands behind it
      AboutDialog.tsx  Help → About Whisker: version, update status, versions for bug reports, links
      Menu.tsx, Dialog.tsx, Toast.tsx, Icon.tsx, keyboard.ts
    query/           Filter query tokenizer and compiler (Android Studio syntax)
    log/             Log entry model and package/process selections
    view/layout.ts   Row geometry for the virtualized view (fixed or soft-wrapped rows)
    mirror/          scrcpy control messages, WebCodecs decoder, input mapping
    styles/          Tailwind entry (index.css), theme colors, element defaults, log rows, app-wide rules
scripts/           build.mjs (esbuild) and make-icon.js
vendor/scrcpy/     Bundled scrcpy-server v4.0 and its Apache-2.0 license
build/             App icon
docs/              The website (GitHub Pages, served from main /docs): index.html, logo.svg (a copy of
                   build/icon.svg), and the screenshots it shares with the README
docs/images/       Screenshots (made from a fictional log, not a real device)
```

## How it works

- **Logs:** the main process runs `adb logcat -v threadtime` and sends parsed lines to the renderer in batches. After a reconnect, it resumes with `-T <last timestamp>` and drops lines it already has.
- **State:** what the UI shows lives in Solid signals and stores (`src/renderer/state/`). A tab's lines are plain arrays, since there can be 200k of them; a `version` signal changes, at most once per frame, when they do.
- **Rendering:** the log view is virtualized. Only the rows on screen are in the DOM, so a tab can hold 200k lines. Rows are keyed by entry, so while lines stream in only the new rows are created; selection, hover and the current find match are class bindings.
- **Mirroring and recording:** Whisker pushes the bundled `scrcpy-server` to the device and reads its H.264 stream through an adb forward tunnel.
  - Mirroring decodes the stream in the renderer with WebCodecs and sends input back over scrcpy's control socket.
  - Recording muxes the same stream into MP4 in the main process, so ffmpeg isn't needed.

## Releasing

1. Set the new version in `package.json` (for example `1.0.1`), commit, and push.
2. Tag the commit and push the tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. The **Release** workflow (`.github/workflows/release.yml`) checks that the tag matches `package.json`, builds on Windows, and publishes a GitHub Release with the installer, the portable `.exe` and `latest.yml`.

Installed copies of Whisker read `latest.yml` from the latest release and update themselves (`src/main/updater.ts`).

To test updates locally without publishing:
1. Build an older and a newer version with a separate app id, so they don't replace your own install:
   ```bash
   npx electron-builder --win nsis -c.extraMetadata.version=0.9.1 -c.appId=com.whisker.updatetest -c.productName=WhiskerUpdateTest -c.directories.output=update-test/0.9.1
   ```
2. Serve the newer one's folder over HTTP, install the older one, and start it with `WHISKER_UPDATE_FEED` set to that URL.

## Screenshots in the README

Please don't commit screenshots of real devices or real app logs, because they can contain serial numbers, account IDs or other private data. The images in `docs/images/` were made by importing a made-up log file.
