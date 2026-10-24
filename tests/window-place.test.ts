// SPDX-License-Identifier: GPL-3.0-only
// The window opens where it was last (KI7MT, 2026-10-24), unless that place
// is no longer on a screen.
import { describe, expect, it } from 'vitest';
import { isWindowBounds, placeWindow } from '../packages/main/window-place.js';
import { readSettings, validateSettingsCommand } from '../packages/main/settings-contract.js';

const main = { x: 0, y: 0, width: 1920, height: 1080 };
const right = { x: 1920, y: 0, width: 2560, height: 1440 };
const saved = { x: 2100, y: 100, width: 1400, height: 900, maximized: false };

describe('where the window opens', () => {
  it('where it was, on the screen it was on', () => {
    expect(placeWindow(saved, [main, right])).toEqual(saved);
  });

  it('at the default when that screen is gone, or only a sliver is on one', () => {
    expect(placeWindow(saved, [main])).toBeUndefined();
    expect(placeWindow({ ...saved, x: 1900 }, [main])).toBeUndefined();
    expect(placeWindow(null, [main])).toBeUndefined();
  });

  it('no larger than the screen it is on, never smaller than the least it can be', () => {
    expect(placeWindow({ ...saved, x: 0, y: 0, width: 3000, height: 2000 }, [main])).toMatchObject({ width: 1920, height: 1080 });
  });

  it('remembers maximized', () => {
    expect(placeWindow({ ...saved, maximized: true }, [main, right])?.maximized).toBe(true);
  });

  it('is read from settings.json like any setting, and only main writes it', () => {
    expect(isWindowBounds(saved)).toBe(true);
    expect(isWindowBounds({ ...saved, width: 10 })).toBe(false);
    expect(isWindowBounds({ ...saved, x: 1.5 })).toBe(false);
    expect(readSettings({ windowBounds: saved }).windowBounds).toEqual(saved);
    expect(readSettings({ windowBounds: 'here' }).windowBounds).toBeNull();
    expect(validateSettingsCommand({ type: 'write', key: 'windowBounds', value: saved })).toBe(false);
  });
});
