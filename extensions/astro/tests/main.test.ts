// SPDX-License-Identifier: GPL-3.0-only
// Astro end to end against a stand-in context: it registers its page and asks
// the core for the active Location and nothing else (QGD-AST-0003,
// QGD-AST-0004).
import { describe, expect, it } from 'vitest';
import type { ExtensionContext, PageProvider } from '../../../packages/extension-api/context.js';
import type { ExtensionRequest } from '../../../packages/extension-api/api-contract.js';
import { activate } from '../src/main.js';

describe('Astro (QGD-AST-0001)', () => {
  it('registers its page, and asks only for the active Location', async () => {
    const providers = new Map<string, PageProvider>();
    const asked: ExtensionRequest[] = [];
    const context: ExtensionContext = {
      extensionId: 'astro',
      request: async request => {
        asked.push(request);
        return { ok: true, kind: 'station.active', station: { name: 'Home', grid: 'DN13sm', latitude: 43.625, longitude: -116.2083 } };
      },
      pages: { register: (id, provider) => { providers.set(id, provider); return { dispose: () => providers.delete(id) }; } },
      subscriptions: []
    };
    activate(context);
    expect([...providers.keys()]).toEqual(['astro']);
    const answer = await providers.get('astro')!({ pageId: 'astro', signal: new AbortController().signal, inputs: { dx: 'FN31' } });
    expect(answer).toMatchObject({ ok: true });
    expect(asked).toEqual([{ kind: 'station.active' }]);
  });
});
