// SPDX-License-Identifier: GPL-3.0-only
// On the Air end to end against a stand-in context: it registers both cards,
// asks the core for NOAA's sources by name, and says so in words when it
// cannot (QGD-HOM-0006, QGD-APP-0008).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ExtensionContext, CardProvider } from '../../../packages/extension-api/context.js';
import type { ExtensionReply, ExtensionRequest } from '../../../packages/extension-api/api-contract.js';
import { activate } from '../src/main.js';

const FILES: Record<string, string> = {
  'noaa-flux': '10cm-flux.json', 'noaa-kp': 'noaa-planetary-k-index.json', 'noaa-scales': 'noaa-scales.json'
};

function context(answer: (request: ExtensionRequest) => ExtensionReply) {
  const providers = new Map<string, CardProvider>();
  const asked: ExtensionRequest[] = [];
  const value: ExtensionContext = {
    extensionId: 'on-the-air',
    request: async request => { asked.push(request); return answer(request); },
    cards: { register: (id, provider) => { providers.set(id, provider); return { dispose: () => providers.delete(id) }; } },
    subscriptions: []
  };
  return { value, providers, asked };
}
const ask = (providers: Map<string, CardProvider>, id: string) => providers.get(id)!({ cardId: id, signal: new AbortController().signal });

describe('On the Air (QGD-HOM-0007)', () => {
  it('registers Conditions and Your station, and fetches NOAA only by registered source name', async () => {
    const { value, providers, asked } = context(request => request.kind === 'source.fetch'
      ? { ok: true, kind: 'source.fetch', body: readFileSync(`tests/fixtures/noaa/quiet/${FILES[request.source]}`, 'utf8'), fresh: true }
      : request.kind === 'station.active'
        ? { ok: true, kind: 'station.active', station: { name: 'Home', grid: 'DN13sm', latitude: 43.625, longitude: -116.2083 } }
        : { ok: true, kind: 'persona.active', persona: { name: 'Home', callsign: 'W1AW' } });
    activate(value);
    expect([...providers.keys()]).toEqual(['conditions', 'your-station']);
    expect(await ask(providers, 'conditions')).toMatchObject({ ok: true });
    expect(asked.map(request => request.kind === 'source.fetch' ? request.source : request.kind).sort()).toEqual(['noaa-flux', 'noaa-kp', 'noaa-scales']);
    const station = JSON.stringify(await ask(providers, 'your-station'));
    expect(station).toContain('W1AW');
    expect(station).toContain('Home · DN13sm');
    expect(station).toContain('Sunrise');
    expect(value.subscriptions).toHaveLength(2);
  });

  it('says NOAA could not be reached when a fetch is refused, and draws Your station with no persona', async () => {
    const { value, providers } = context(request => request.kind === 'source.fetch'
      ? { ok: false, error: 'The reference source could not be reached.' }
      : { ok: false, error: 'refused', refused: 'persona:list' });
    activate(value);
    expect(await ask(providers, 'conditions')).toEqual({ ok: false, reason: 'NOAA could not be reached just now.' });
    expect(JSON.stringify(await ask(providers, 'your-station'))).toContain('No callsign is active yet.');
  });

  it('says the data could not be read when NOAA sends something else', async () => {
    const { value, providers } = context(() => ({ ok: true, kind: 'source.fetch', body: '<html>maintenance</html>', fresh: true }));
    activate(value);
    expect(await ask(providers, 'conditions')).toEqual({ ok: false, reason: "NOAA's data could not be read just now." });
  });
});
