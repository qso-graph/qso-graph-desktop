// SPDX-License-Identifier: GPL-3.0-only
// Astro: the sun, the moon and the grey line at the active Location
// (QGD-AST-*). An official extension, built in and on by default, which the
// operator can turn off (QGD-AST-0001). It reaches the core only through
// `context` (QGD-APP-0002) and holds one grant, station:active
// (QGD-AST-0003); everything else is calculated here, with no request to the
// network in any Part (QGD-AST-0004).
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import { astroPage } from './page.js';

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(context.pages.register('astro', async ({ signal, inputs }) => {
    const reply = await context.request({ kind: 'station.active' }, { signal });
    const station = reply.ok && reply.kind === 'station.active' ? reply.station : null;
    return astroPage(station, new Date(), { ...(inputs.dx ? { dx: inputs.dx } : {}) });
  }));
}
