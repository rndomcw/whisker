// Bundles the TypeScript sources into out/ with esbuild.
//   out/main/main.js        Electron main process
//   out/preload/preload.js  preload bridge
//   out/renderer/           index.html, app.js, app.css, logo.svg
// Usage: node scripts/build.mjs [--watch]

import { context, build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

const configs = [
  {
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'out/main/main.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'out/preload/preload.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: ['src/renderer/main.ts'],
    outfile: 'out/renderer/app.js',
    platform: 'browser',
    format: 'iife',
  },
];

await rm('out', { recursive: true, force: true });
await mkdir('out/renderer', { recursive: true });
await cp('src/renderer/index.html', 'out/renderer/index.html');
await cp('build/icon.svg', 'out/renderer/logo.svg'); // the logo in the header

if (watch) {
  for (const config of configs) await (await context(config)).watch();
  console.log('Watching for changes… (index.html is copied only at start)');
} else {
  await Promise.all(configs.map(config => build(config)));
}
