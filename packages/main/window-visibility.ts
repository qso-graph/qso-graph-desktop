// SPDX-License-Identifier: GPL-3.0-only
// Whether a window may appear on screen.
//
// KI7MT, 2026-10-10: the endless window flashing during test runs stops. He
// called it "like endless loops" — ten suites launch the real application, and
// each one put a window on his desktop while he was working.
//
// A suite run is told apart by `QG_DESKTOP_USER_DATA_DIR`. That is not a flag
// invented for this: a suite has to redirect userData or it writes into the
// operator's real profile, so every suite that launches the application
// already sets it and none can forget. Production never sets it.
//
// `show: false` alone is not enough, and that is what the application already
// had: the window is built hidden to avoid a white flash, and then
// `ready-to-show` shows it. What stops it appearing is not revealing it.
//
// `paintWhenInitiallyHidden` is Electron's default, and is stated here because
// the suites depend on it: a window that is never shown still has to paint, or
// `ready-to-show` never fires and nothing can be captured from it.
export interface WindowVisibility {
  readonly show: boolean;
  readonly paintWhenInitiallyHidden: boolean;
  // Whether `ready-to-show` should reveal the window.
  readonly reveal: boolean;
}

export function isSuiteRun(env: NodeJS.ProcessEnv = process.env): boolean {
  const userData = env.QG_DESKTOP_USER_DATA_DIR;
  return typeof userData === 'string' && userData.length > 0;
}

export function windowVisibility(env: NodeJS.ProcessEnv = process.env): WindowVisibility {
  return { show: false, paintWhenInitiallyHidden: true, reveal: !isSuiteRun(env) };
}
