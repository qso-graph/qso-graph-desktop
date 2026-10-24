// SPDX-License-Identifier: GPL-3.0-only
// View → Zoom (KI7MT, 2026-10-24): larger or smaller, as every desktop
// application offers, but not without end: from 80% to 150% in the steps a
// browser uses. Ctrl (⌘ on a Mac) and the mouse wheel move by the same
// steps. Pure, so it is tested without Electron.

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

// The next step from the zoom there is now, in a direction: in (1), out
// (-1), or back to actual size (0). A zoom between steps moves to the
// nearest step that way; at either end it stays.
export function nextZoom(current: number, direction: -1 | 0 | 1): number {
  if (direction === 0 || !Number.isFinite(current)) return 1;
  if (direction > 0) return ZOOM_STEPS.find(step => step > current + 0.001) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find(step => step < current - 0.001) ?? ZOOM_STEPS[0];
}
