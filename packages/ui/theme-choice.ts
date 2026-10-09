// SPDX-License-Identifier: GPL-3.0-only
// System, Light and Dark — QGD-FRM-0002, with System the default.
//
// Here rather than in the settings contract, where it was, because these are
// words on a control: a theme selector is a component, and the three values it
// offers are its own vocabulary. The settings contract imports them to say
// what a stored theme may be, which is the direction that leaves `ui`
// depending on nothing (QGD-REP-0004 — what an application may look like is a
// different contract from what it may call, and a component package that
// reaches back into the frame is neither).
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

// What the control shows for each. Presentation, so it lives with them.
export const THEME_LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
