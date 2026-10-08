// SPDX-License-Identifier: GPL-3.0-only
// The renderer's build. Vite and Svelte (QGD-FRM-0005) for the screens; the
// main and utility processes stay on tsc, because they are Node and have no
// bundling to do.
//
// Output names are pinned rather than hashed. src/policy.ts serves exactly
// three resources over the qg: scheme and nothing else (QGD-PRC-0006), and a
// hashed filename would mean widening that allowlist to a pattern. Three names
// are easier to be sure about than a pattern.
//
// No module-preload polyfill and no inline anything: QGD-SEC-0008 forbids
// inline scripts, and the content policy that enforces it would reject the
// polyfill Vite injects by default.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsDir: '.',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[name].js',
        assetFileNames: assetInfo => (assetInfo.names?.[0]?.endsWith('.css') ? 'style.css' : '[name][extname]')
      }
    }
  }
});
