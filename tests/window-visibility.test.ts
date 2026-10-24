// SPDX-License-Identifier: GPL-3.0-only
// No suite run puts a window on the operator's screen.
//
// KI7MT, 2026-10-10, as an urgent decision: ten suites launch the real
// application and each one showed a window while he was working — "like
// endless loops". This is the rule that stops it, tested here because the
// alternative is testing it by watching a screen.
//
// The defect this replaced is worth naming, because `show: false` looked like
// it was already handled: the window was *built* hidden to avoid a white
// flash, and then `ready-to-show` showed it unconditionally. The construction
// option was never the thing that mattered.
import { describe, expect, it } from 'vitest';
import { isSuiteRun, windowVisibility } from '../packages/main/window-visibility.js';

describe('a suite run is told apart from a real one', () => {
  it('is a suite run when userData has been redirected', () => {
    // Not a flag invented for this: a suite that did not redirect userData
    // would write into the operator's real profile, so every suite that
    // launches the application sets this and none can forget to.
    expect(isSuiteRun({ QG_DESKTOP_USER_DATA_DIR: '/tmp/suite-profile' })).toBe(true);
  });

  it('is not a suite run when it is absent or empty', () => {
    expect(isSuiteRun({})).toBe(false);
    expect(isSuiteRun({ QG_DESKTOP_USER_DATA_DIR: '' })).toBe(false);
    // The other two a suite sets are not enough on their own: a log directory
    // is something an operator could plausibly redirect.
    expect(isSuiteRun({ QG_DESKTOP_LOG_DIR: '/tmp/logs' })).toBe(false);
    expect(isSuiteRun({ QG_DESKTOP_PROFILE_DIR: '/tmp/profile' })).toBe(false);
  });
});

describe('what a window is allowed to do', () => {
  it('never reveals itself during a suite run', () => {
    const visibility = windowVisibility({ QG_DESKTOP_USER_DATA_DIR: '/tmp/suite-profile' });
    expect(visibility.show).toBe(false);
    expect(visibility.reveal).toBe(false);
  });

  it('still paints during a suite run, so there is something to capture', () => {
    // Without this a window that is never shown never fires `ready-to-show`,
    // and every screenshot, axe and story suite has nothing to read.
    const visibility = windowVisibility({ QG_DESKTOP_USER_DATA_DIR: '/tmp/suite-profile' });
    expect(visibility.paintWhenInitiallyHidden).toBe(true);
  });

  it('reveals itself for an operator, and still starts hidden', () => {
    const visibility = windowVisibility({});
    // Hidden at construction either way: that is what avoids the white frame
    // before the renderer themes itself (QGD-FRM-0001).
    expect(visibility.show).toBe(false);
    expect(visibility.reveal).toBe(true);
  });
});
