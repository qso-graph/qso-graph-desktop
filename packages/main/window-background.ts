// SPDX-License-Identifier: GPL-3.0-only
// The colour the window is painted with before the renderer has drawn anything.
//
// QGD-FRM-0001 is about the shell following the operating system, and the first
// frame is part of the shell: a window that opens white on a dark system has
// already failed it once before any stylesheet loads. That decision has to be
// made in the main process, which is why these two values live here and not in
// packages/renderer/theme.ts — the main process is compiled without the DOM library
// and cannot import it.
//
// They are copies of the --page token in packages/renderer/style.css, and a test
// reads both out of that stylesheet and requires them to match. A copy that
// drifts shows up as a flash of the wrong colour at every launch, which is
// exactly the kind of thing nobody files a bug about.
import type { ThemeChoice } from './settings-contract.js';

export const WINDOW_BACKGROUND = { light: '#f4f6f8', dark: '#0a0e13' } as const;

export function windowBackground(choice: ThemeChoice, systemPrefersDark: boolean): string {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark);
  return dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}
