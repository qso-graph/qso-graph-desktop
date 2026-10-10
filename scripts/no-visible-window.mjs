// SPDX-License-Identifier: GPL-3.0-only
// The check behind KI7MT's decision of 2026-10-10: no suite shows a window.
//
// `packages/main/window-visibility.ts` is where the rule lives and
// `tests/window-visibility.test.ts` proves the rule. This proves the running
// application obeys it, which is a different claim: the rule could be right
// and the wiring wrong, and the only symptom either way is a window appearing
// on the operator's screen while he works.
//
// **It waits for a painted frame first, and that is the whole difficulty.**
// The window is revealed from `ready-to-show`, which fires on the first paint
// — so asking `isVisible()` any earlier answers false whatever the code says.
// The first version of this check did exactly that, and passed with the defect
// planted back in. Two animation frames in the renderer are the signal that a
// paint has happened and therefore that `ready-to-show` has already run.
//
// Called by every suite that launches the application through Playwright.
// `packaged-smoke` drives the packaged binary over the debugging protocol and
// has no handle on the main process, so it cannot ask; it runs the same
// `main.ts`, and the unit test covers the decision it makes.
export async function assertNoVisibleWindow(application, page, where) {
  // A frame has been produced by the time the second callback runs, so the
  // main process has had `ready-to-show` and has decided.
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
  }));
  const visible = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter(window => window.isVisible())
      .map(window => window.getTitle()));
  if (visible.length > 0) {
    throw new Error(
      `${where}: ${visible.length} window(s) on screen during a suite run `
      + `(${visible.join(', ')}). A suite must not be visible: see `
      + 'packages/main/window-visibility.ts.'
    );
  }
}
