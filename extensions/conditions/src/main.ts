// SPDX-License-Identifier: GPL-3.0-only
// Conditions: QSO Graph Desktop's built-in extension for solar flux, the K
// and A indices, NOAA's space weather scales and the band outlook
// (QGD-HOM-0008). Its own extension, so its switch in Settings turns off
// Conditions and nothing else (KI7MT, 2026-10-23: "On switch, the lights go
// out"); it was On the Air's first page until then.
//
// It runs in the extension host (QGD-APP-0015) and reaches the core only
// through `context` (QGD-APP-0002): NOAA's data is fetched by the core from
// the sources the register names. The core decides when the page is asked
// for (QGD-HOM-0005); this module only answers.
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import type { PageAnswer } from '../../../packages/extension-api/pages.js';
import { conditionsPage, parseConditions } from './conditions.js';

const UNREACHABLE: PageAnswer = { ok: false, reason: 'NOAA could not be reached just now.' };
const UNREADABLE: PageAnswer = { ok: false, reason: "NOAA's data could not be read just now." };

async function fetchBody(context: ExtensionContext, source: string, signal: AbortSignal): Promise<string | undefined> {
  const reply = await context.request({ kind: 'source.fetch', source }, { signal });
  return reply.ok && reply.kind === 'source.fetch' ? reply.body : undefined;
}

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(context.pages.register('conditions', async ({ signal }) => {
    const [flux, kp, scales] = await Promise.all(
      ['noaa-flux', 'noaa-kp', 'noaa-scales'].map(source => fetchBody(context, source, signal)));
    if (flux === undefined || kp === undefined || scales === undefined) return UNREACHABLE;
    const conditions = parseConditions({ flux, kp, scales });
    return conditions ? conditionsPage(conditions) : UNREADABLE;
  }));
}
