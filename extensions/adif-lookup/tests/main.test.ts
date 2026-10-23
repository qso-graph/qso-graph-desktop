// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup end to end against a stand-in context: it registers its page,
// asks the core to search only when something is typed, and passes on what the
// core says when it cannot.
import { describe, expect, it } from 'vitest';
import type { ExtensionContext, PageProvider } from '../../../packages/extension-api/context.js';
import type { ExtensionReply, ExtensionRequest } from '../../../packages/extension-api/api-contract.js';
import { activate } from '../src/main.js';

function context(answer: (request: ExtensionRequest) => ExtensionReply) {
  const providers = new Map<string, PageProvider>();
  const asked: ExtensionRequest[] = [];
  const value: ExtensionContext = {
    extensionId: 'adif-lookup',
    request: async request => { asked.push(request); return answer(request); },
    pages: { register: (id, provider) => { providers.set(id, provider); return { dispose: () => providers.delete(id) }; } },
    subscriptions: []
  };
  return { value, providers, asked };
}
const ask = (providers: Map<string, PageProvider>, inputs: Record<string, string>) =>
  providers.get('lookup')!({ pageId: 'lookup', signal: new AbortController().signal, inputs });

describe('ADIF Lookup', () => {
  it('asks nothing until something is typed, then searches by what was typed', async () => {
    const { value, providers, asked } = context(() => ({ ok: true, kind: 'adif.search', entries: [] }));
    activate(value);
    expect([...providers.keys()]).toEqual(['lookup']);
    expect(await ask(providers, {})).toMatchObject({ ok: true });
    expect(asked).toEqual([]);
    await ask(providers, { q: 'FT8' });
    expect(asked).toEqual([{ kind: 'adif.search', query: 'FT8' }]);
  });

  it('passes on the core\'s words when it cannot search', async () => {
    const { value, providers } = context(() => ({ ok: false, error: 'ADIF\'s definitions are not downloaded. Download them in Settings, then try again.' }));
    activate(value);
    expect(await ask(providers, { q: 'FT8' })).toMatchObject({ ok: true, data: { sections: [{ shape: 'alert', text: expect.stringMatching(/not downloaded/) }] } });
  });
});
