// SPDX-License-Identifier: GPL-3.0-only
// Where the window opens (KI7MT, 2026-10-24): where it was when the
// application last closed, its size and whether it was maximized, as long as
// that place is still on a screen. A monitor unplugged, or a laptop away from
// its desk, and it opens at its default size on the main screen instead of
// somewhere nobody can see it. Pure, so it is tested without Electron.

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}
export interface Area { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 420;
// Enough of the window on a screen to take hold of its title bar.
const VISIBLE_WIDTH = 200;
const VISIBLE_HEIGHT = 60;

const whole = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

// As settings.json holds it, checked like every other setting.
export function isWindowBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const bounds = value as Record<string, unknown>;
  return Object.keys(bounds).length === 5
    && whole(bounds.x, -100_000, 100_000) && whole(bounds.y, -100_000, 100_000)
    && whole(bounds.width, MIN_WIDTH, 100_000) && whole(bounds.height, MIN_HEIGHT, 100_000)
    && typeof bounds.maximized === 'boolean';
}

// The saved place, if enough of it is on one of the screens there are now;
// no larger than the screen it is mostly on. Undefined means the default.
export function placeWindow(saved: WindowBounds | null | undefined, screens: readonly Area[]): WindowBounds | undefined {
  if (!saved) return undefined;
  const overlap = (area: Area): { width: number; height: number } => ({
    width: Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x),
    height: Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y)
  });
  let best: Area | undefined;
  let most = 0;
  for (const area of screens) {
    const { width, height } = overlap(area);
    if (width >= VISIBLE_WIDTH && height >= VISIBLE_HEIGHT && width * height > most) { best = area; most = width * height; }
  }
  if (!best) return undefined;
  return {
    x: saved.x, y: saved.y,
    width: Math.max(MIN_WIDTH, Math.min(saved.width, best.width)),
    height: Math.max(MIN_HEIGHT, Math.min(saved.height, best.height)),
    maximized: saved.maximized
  };
}
