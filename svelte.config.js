// SPDX-License-Identifier: GPL-3.0-only
// One Svelte configuration, read by both the application build (vite.config.mjs)
// and the gallery (.storybook/main.js). Two copies would be two chances for the
// gallery to render a component differently from the way the shell does, which
// is the one thing QGD-FRM-0006 and QGD-FRM-0007 exist to prevent.
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // Components are written in TypeScript, like the rest of the renderer.
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Svelte 5 runes, explicitly: no component may fall back to the legacy
    // reactivity model, so there is one way state is written here.
    runes: true
  }
};
