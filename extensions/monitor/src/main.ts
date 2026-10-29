// SPDX-License-Identifier: GPL-3.0-only
// The Monitor (QGD-INT-0023): an official extension, starting off. It holds
// one grant, integration:events, and receives the events the adapters that
// are on decode; it never sees a byte, and sends nothing to any program
// (QGD-INT-0021). Read-only.
//
// Its page is live: as events arrive it says so, and the core asks for the
// page again while it is open (manifest.ts live).
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import { createWindow } from './window.js';
import { cyclesShown, monitorPage } from './page.js';

export function activate(context: ExtensionContext): void {
  const window = createWindow();
  context.subscriptions.push(context.integration.onEvents(events => {
    if (window.take(events, Date.now())) context.pages.changed('monitor');
  }));
  context.subscriptions.push(context.pages.register('monitor', ({ inputs, settings }) =>
    monitorPage(window, inputs.view, Date.now(), cyclesShown(settings.cycles))));
  context.subscriptions.push({ dispose: () => window.clear() });
}
