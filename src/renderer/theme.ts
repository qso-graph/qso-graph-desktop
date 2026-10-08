// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0001 and QGD-FRM-0002: the theme follows the operating system by
// default, changes with it while running, and can be overridden.
//
// The decision is pure so it can be tested without a window; applying it is the
// one line underneath. data-theme on the document element is what the gallery
// switches too, so a component is seen the way the application renders it.
import type { ThemeChoice } from '../settings-contract.js';

export type Theme = 'light' | 'dark';

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemPrefersDark ? 'dark' : 'light';
}

// A theme the user asked for by name is pinned; System is followed.
export function isPinned(choice: ThemeChoice): boolean {
  return choice !== 'system';
}

// `pinned` is whether the user chose this theme, as opposed to it being read
// off the operating system. It decides one thing, and that thing is load
// bearing: prefers-color-scheme reports the page's USED colour scheme, not the
// system's preference, so writing color-scheme here makes the media query
// report back whatever was just written. Pinning it on the System setting
// therefore froze the shell at its first reading and QGD-FRM-0001 could never
// be met — the stylesheet's `color-scheme: light dark` is what has to stand
// while the shell is following along.
export function applyTheme(theme: Theme, pinned: boolean, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  // So the scrollbars and form controls the platform draws match the page.
  // Cleared rather than set when following, which returns the root to the
  // stylesheet's "light dark" and the media query to the system.
  root.style.colorScheme = pinned ? theme : '';
}

// What the shell reads the system's appearance from. Declared here so a test
// and the preload agree on the shape of it.
export interface Appearance {
  prefersDark(): Promise<boolean>;
  onChange(listener: (prefersDark: boolean) => void): () => void;
}

// Returns a function that stops following. QGD-FRM-0001's "changes with it
// while running" is what this makes true, without a restart.
//
// Two sources, deliberately. The main process is the authority: on Electron 44
// the renderer's media query reported light while the system was dark and
// nativeTheme in the main process had it right (src/system-appearance.ts
// records the measurement). The media query stays subscribed because when
// Chromium does report a change it is the earliest signal, and because the two
// agreeing is the state we want to return to.
export function followSystem(
  onChange: (systemPrefersDark: boolean) => void,
  appearance: Appearance | undefined = window.appearance
): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  const stopListening = appearance?.onChange(onChange);

  if (appearance) {
    // Asked, not read. The media query's value is not applied first: it is the
    // one that can be wrong, and applying it would paint the wrong theme and
    // then correct it.
    void appearance.prefersDark().then(onChange, () => onChange(query.matches));
  } else {
    onChange(query.matches);
  }

  return () => {
    query.removeEventListener('change', listener);
    stopListening?.();
  };
}
