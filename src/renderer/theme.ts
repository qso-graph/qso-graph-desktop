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

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  // So the scrollbars and form controls the platform draws match the page.
  root.style.colorScheme = theme;
}

// Returns a function that stops following. The media query is what makes
// QGD-FRM-0001's "changes with it while running" true without a restart.
export function followSystem(onChange: (systemPrefersDark: boolean) => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  onChange(query.matches);
  return () => query.removeEventListener('change', listener);
}
