// SPDX-License-Identifier: GPL-3.0-only
// View → Zoom moves in fixed steps, from 80% to 150% and no further (#57).
import { describe, expect, it } from 'vitest';
import { ZOOM_STEPS, nextZoom } from '../packages/main/window-zoom.js';

describe('zoom', () => {
  it('steps in and out from actual size', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1.1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.9);
  });

  it('stops at either end', () => {
    expect(nextZoom(1.5, 1)).toBe(1.5);
    expect(nextZoom(0.8, -1)).toBe(0.8);
    expect(ZOOM_STEPS.at(0)).toBe(0.8);
    expect(ZOOM_STEPS.at(-1)).toBe(1.5);
  });

  it('a zoom between steps moves to the nearest that way; Actual Size is 100%', () => {
    expect(nextZoom(1.17, 1)).toBe(1.25);
    expect(nextZoom(1.17, -1)).toBe(1.1);
    expect(nextZoom(3, -1)).toBe(1.5);
    expect(nextZoom(1.25, 0)).toBe(1);
    expect(nextZoom(Number.NaN, 1)).toBe(1);
  });
});
