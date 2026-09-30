'use strict';

// Renders build/icon.svg to build/icon.png (1024px) and build/icon.ico (16–256px).
// Run with: npm run icon

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const SIZE = 1024;
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// ICO with PNG-compressed entries (supported since Windows Vista).
function buildIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);            // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);     // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);                       // palette colors
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);                    // planes
    header.writeUInt16LE(32, e + 6);                   // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD_DIR, 'icon.svg'), 'utf8');
  const html = '<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}' +
    `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body>${svg}</body></html>`;
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300));
  const full = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });

  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), full.toPNG());
  const pngs = ICO_SIZES.map(size => ({ size, data: full.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), buildIco(pngs));
  console.log(`Wrote icon.png (${SIZE}px) and icon.ico (${ICO_SIZES.join(', ')}px)`);
  app.quit();
});
