// SPDX-License-Identifier: GPL-3.0-only
// Separate from vite.config.mjs, which sets root to src/renderer for the
// renderer's own build. Without this, vitest inherits that root and looks for
// the suites inside the renderer, where there are none.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.{test,spec}.{ts,mts,mjs}']
  }
});
