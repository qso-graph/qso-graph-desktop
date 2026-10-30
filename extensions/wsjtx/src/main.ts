// SPDX-License-Identifier: GPL-3.0-only
// The WSJT-X adapter (QGD-INT-0022): an official extension, starting off.
// Turned on, Integrations opens its port (QGD-INT-0020); what WSJT-X sends
// arrives here as bytes and the sender's address, and goes on to the
// Monitor as events. It holds one grant, integration:receive, and reaches
// the core only through `context` (QGD-APP-0002).
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import { createAdapter } from './adapter.js';

// The extension API's most events in one request (integration-events.ts).
const BATCH = 512;

export function activate(context: ExtensionContext): void {
  const adapter = createAdapter();
  context.subscriptions.push(context.integration.onDatagrams(datagrams => {
    const { events, replies, malformed } = adapter.receive(datagrams);
    for (let at = 0; at < Math.max(events.length, malformed > 0 ? 1 : 0); at += BATCH) {
      void context.integration.publish(events.slice(at, at + BATCH), at === 0 ? malformed : 0);
    }
    // Replay, the one reply (QGD-INT-0009); refused or not, the decodes it
    // asks for are WSJT-X's to send, and new ones arrive either way.
    for (const reply of replies) void context.integration.reply(reply.to, reply.bytes);
  }));
  context.subscriptions.push({ dispose: () => adapter.reset() });
}
