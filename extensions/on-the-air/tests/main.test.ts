// SPDX-License-Identifier: GPL-3.0-only
// On the Air end to end against a stand-in context: it registers Conditions,
// asks the core for NOAA's sources by name, and says so in words when it
// cannot (QGD-HOM-0006, QGD-APP-0008).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ExtensionContext, PageProvider } from '../../../packages/extension-api/context.js';
import type { ExtensionReply, ExtensionRequest } from '../../../packages/extension-api/api-contract.js';
import { activate } from '../src/main.js';

const FILES: Record<string, string> = {
  'noaa-flux': '10cm-flux.json', 'noaa-kp': 'noaa-planetary-k-index.json', 'noaa-scales': 'noaa-scales.json', 'pota-spots': 'activator.json'
};

function context(answer: (request: ExtensionRequest) => ExtensionReply) {
  const providers = new Map<string, PageProvider>();
  const asked: ExtensionRequest[] = [];
  const value: ExtensionContext = {
    extensionId: 'on-the-air',
    request: async request => { asked.push(request); return answer(request); },
    pages: { register: (id, provider) => { providers.set(id, provider); return { dispose: () => providers.delete(id) }; } },
    subscriptions: []
  };
  return { value, providers, asked };
}
const ask = (providers: Map<string, PageProvider>, id: string) => providers.get(id)!({ pageId: id, signal: new AbortController().signal });

describe('On the Air (QGD-HOM-0007)', () => {
  it('registers Conditions, and fetches NOAA only by registered source name', async () => {
    const { value, providers, asked } = context(request => request.kind === 'source.fetch'
      ? { ok: true, kind: 'source.fetch', body: readFileSync(`tests/fixtures/noaa/quiet/${FILES[request.source]}`, 'utf8'), fresh: true }
      : { ok: false, error: 'refused', refused: 'station:active' });
    activate(value);
    expect([...providers.keys()]).toEqual(['conditions', 'parks', 'near', 'wanted']);
    expect(await ask(providers, 'conditions')).toMatchObject({ ok: true });
    expect(asked.map(request => request.kind === 'source.fetch' ? request.source : request.kind).sort()).toEqual(['noaa-flux', 'noaa-kp', 'noaa-scales']);
    expect(await ask(providers, 'parks')).toMatchObject({ ok: true });
    // POTA's spots by registered name, then ADIF's bands to name each band.
    // And the program and entity of each location on the air, by name.
    expect(asked.slice(-4, -1)).toEqual([{ kind: 'source.fetch', source: 'pota-spots' }, { kind: 'adif.bands' }, { kind: 'area.get' }]);
    expect(asked.at(-1)).toMatchObject({ kind: 'pota.places' });
    expect(value.subscriptions).toHaveLength(4);
  });

  it('draws Near Me from POTA\'s park list on this computer, asking nothing of the network', async () => {
    const park = { reference: 'US-0001', name: 'Example Park', latitude: 43.7, longitude: -116.1, locations: 'US-ID' };
    const { value, providers, asked } = context(request => request.kind === 'pota.near'
      ? { ok: true, kind: 'pota.near', parks: [park] }
      : request.kind === 'station.active' ? { ok: true, kind: 'station.active', station: { name: 'Home', latitude: 43.6, longitude: -116.2 } }
        : { ok: false, error: 'refused' });
    activate(value);
    expect(await ask(providers, 'near')).toMatchObject({ ok: true });
    expect(asked.map(request => request.kind)).toEqual(['pota.near', 'station.active', 'pota.places']);
    const missing = context(() => ({ ok: false, error: 'POTA parks are not downloaded.' }));
    activate(missing.value);
    expect(await ask(missing.providers, 'near')).toEqual({ ok: false, reason: 'POTA parks are not downloaded.' });
  });

  it('draws Most Wanted from POTA\'s activation counts, and says why when it has none', async () => {
    const park = { reference: 'US-0001', name: 'Example Park', latitude: 43.7, longitude: -116.1, locations: 'US-ID', activations: 0 };
    const { value, providers, asked } = context(request => request.kind === 'pota.activations'
      ? { ok: true, kind: 'pota.activations', parks: [park], fetchedAt: '2026-10-23T12:00:00Z', locations: ['US-ID'] }
      : request.kind === 'station.active' ? { ok: true, kind: 'station.active', station: { name: 'Home', latitude: 43.6, longitude: -116.2 } }
        : { ok: false, error: 'refused' });
    activate(value);
    expect(await ask(providers, 'wanted')).toMatchObject({ ok: true });
    // Its counts come through the core, which asks POTA (QGD-REF-0019).
    expect(asked.map(request => request.kind)).toEqual(['pota.activations', 'station.active', 'pota.places']);
    const missing = context(() => ({ ok: false, error: 'POTA activations are not downloaded for My Area.' }));
    activate(missing.value);
    expect(await ask(missing.providers, 'wanted')).toEqual({ ok: false, reason: 'POTA activations are not downloaded for My Area.' });
  });

  it('says NOAA could not be reached when a fetch is refused', async () => {
    const { value, providers } = context(() => ({ ok: false, error: 'The reference source could not be reached.' }));
    activate(value);
    expect(await ask(providers, 'conditions')).toEqual({ ok: false, reason: 'NOAA could not be reached just now.' });
    expect(await ask(providers, 'parks')).toEqual({ ok: false, reason: 'POTA could not be reached just now.' });
  });

  it('says the data could not be read when NOAA sends something else', async () => {
    const { value, providers } = context(() => ({ ok: true, kind: 'source.fetch', body: '<html>maintenance</html>', fresh: true }));
    activate(value);
    expect(await ask(providers, 'conditions')).toEqual({ ok: false, reason: "NOAA's data could not be read just now." });
    expect(await ask(providers, 'parks')).toEqual({ ok: false, reason: "POTA's spots could not be read just now." });
  });
});
