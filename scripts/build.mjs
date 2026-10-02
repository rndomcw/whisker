// Bundles the TypeScript sources into out/ with esbuild.
//   out/main/main.js        Electron main process
//   out/preload/preload.js  preload bridge
//   out/renderer/           index.html, app.js, logo.svg, and app.css (built by the Tailwind CLI)
// Usage: node scripts/build.mjs [--watch]

import { spawn } from 'node:child_process';
import { context, build } from 'esbuild';
import { solidPlugin } from 'esbuild-plugin-solid';
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
    entryPoints: ['src/renderer/main.tsx'],
    outfile: 'out/renderer/app.js',
    platform: 'browser',
    format: 'iife',
    plugins: [solidPlugin()], // compiles the JSX with babel-preset-solid
  },
];

await rm('out', { recursive: true, force: true });
await mkdir('out/renderer', { recursive: true });
await cp('src/renderer/index.html', 'out/renderer/index.html');
await cp('build/icon.svg', 'out/renderer/logo.svg'); // the logo in the header

/** Runs the Tailwind CLI, which scans src/renderer for classes and writes out/renderer/app.css. */
function tailwind() {
  const cli = 'node_modules/@tailwindcss/cli/dist/index.mjs'; // the package's "bin"; it has no importable entry
  const args = [cli, '-i', 'src/renderer/styles/index.css', '-o', 'out/renderer/app.css', ...(watch ? ['--watch=always'] : [])];
  // "always": keep watching even though stdin isn't a terminal (the CLI otherwise stops when stdin closes).
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  return new Promise((resolve, reject) => {
    if (watch) { resolve(); return; } // keeps running alongside esbuild
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`tailwind exited with code ${code}`))));
  });
}

if (watch) {
  for (const config of configs) await (await context(config)).watch();
  await tailwind();
  console.log('Watching for changes… (index.html is copied only at start)');
} else {
  await Promise.all([...configs.map(config => build(config)), tailwind()]);
}
