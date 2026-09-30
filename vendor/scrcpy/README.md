# scrcpy-server

`scrcpy-server` is the device-side component of [scrcpy](https://github.com/Genymobile/scrcpy) v4.0 (Apache License 2.0, see `LICENSE`), copied unchanged from the official Windows release.

The app pushes it to the device to mirror the screen. The protocol version is pinned in `src/mirror.js` (`SCRCPY_VERSION`). When upgrading, replace this file with the same scrcpy release and update that constant.
