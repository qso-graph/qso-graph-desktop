// SPDX-License-Identifier: GPL-3.0-only
// Separate from vite.config.mjs, which sets root to src/renderer for the
// renderer's own build. Without this, vitest inherits that root and looks for
// the suites inside the renderer, where there are none.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.{test,spec}.{ts,mts,mjs}', 'extensions/*/tests/**/*.{test,spec}.ts'],
    // Vitest's default 5 s is too tight for suites that start processes or open SQLite on a hosted
    // Windows runner: two passing tests timed out there at 6.1 s and 13.9 s (2026-10-28, runs #129
    // and #130) with nothing wrong in them. A test that hangs still fails, after 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
