// SPDX-License-Identifier: GPL-3.0-only
// What the proof extensions used to prove, proven here instead.
//
// Three of the thirteen checks in the retired app-proofs suite were about the
// seam rather than the decision: that allowing a grant takes effect with no
// reload of the window, that withdrawing it takes effect with no restart, and
// that a permitted call actually reaches the credential core. extension-runtime
// answers *whether* a request is allowed; this answers what happens either
// way (`QGD-APP-0012`, `QGD-APP-0014`).
//
// Every port is a recorder. The strongest assertion here is not that an
// allowed call arrives — it is that a refused one touches nothing: a
// permission system that refuses *after* the side effect has happened is not
// a permission system, and nothing in the decision tests can see that.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { grantIds, validateGrantRegister } from '../packages/extension-api/grants.js';
import { loadExtensions } from '../packages/main/extension-runtime.js';
import { buildInventory, createServe, type ExtensionBrokerPorts, type ServeDeps } from '../packages/main/extension-serve.js';

const register = validateGrantRegister(JSON.parse(await readFile('data/extension-grants.json', 'utf8')));
const known = grantIds(register);

const SOLAR = { id: 'solar', name: 'Space weather', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: ['source:solar'], page: 'SolarPage.svelte' };
const QRZ = { id: 'qrz-lookup', name: 'Callsign lookup', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: ['service:qrz', 'persona:list'], page: 'LookupPage.svelte' };
const BARE = { id: 'bare', name: 'Nothing at all', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: [], page: 'Bare.svelte' };

// Every port records what it was asked and by whom, so "nothing was touched"
// is a thing a test can assert rather than infer.
function recorder(allowed: Record<string, readonly string[]> = {}) {
  const calls: string[] = [];
  let allowedReads = 0;
  // Replaced, never mutated in place.
  //
  // The first version of this helper mutated one object that the closure
  // already held, so reading the allowed set once at load still saw later
  // changes — and the allow and withdraw tests below passed against a frame
  // that only read it at load, which is the defect they exist to catch. A
  // fresh object each time makes them depend on the re-read they claim to
  // prove.
  let current: Record<string, readonly string[]> = { ...allowed };
  const ports: ExtensionBrokerPorts = {
    allowed: () => { allowedReads += 1; return current; },
    personas: async () => { calls.push('personas'); return [{ name: 'Home station', callsign: 'W1AW' }]; },
    fetchSource: async url => { calls.push(`fetchSource:${url}`); return { body: 'sfi 150', fresh: true }; },
    callService: async (service, persona, operation, parameters) => {
      calls.push(`callService:${service}/${persona}/${operation}/${JSON.stringify(parameters)}`);
      return { outcome: 'success', call: 'W1AW' };
    }
  };
  const warnings: string[] = [];
  const deps: ServeDeps = {
    register,
    sources: { solar: 'https://services.swpc.noaa.gov/indices.json' },
    ports,
    log: { warn: (_fields, message) => warnings.push(message) },
    extensions: [...loadExtensions(
      [SOLAR, QRZ, BARE].map((value, at) => ({ source: `extensions/${at}/manifest.json`, value })),
      register, allowed
    ).loaded],
    refused: []
  };
  return {
    serve: createServe(deps), deps, calls, warnings,
    allowedReads: () => allowedReads,
    setAllowed: (next: Record<string, readonly string[]>) => { current = { ...next }; }
  };
}

describe('a refused request reaches nothing', () => {
  it('touches no port when the grant was never allowed', async () => {
    const it0 = recorder();
    const reply = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', persona: 'Home station',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.refused).toBe('service:qrz');
    // The point of the whole area: no credential was reached.
    expect(it0.calls, 'a refused call must not reach the credential core').toEqual([]);
    expect(it0.warnings.join(' ')).toContain('service:qrz');
  });

  it('touches no port when the extension never declared the grant', async () => {
    const it0 = recorder({ bare: ['persona:list'] });
    const reply = await it0.serve('bare', { kind: 'persona.list' });
    expect(reply.ok).toBe(false);
    // Allowed in settings, never declared in the manifest: still refused, and
    // the personas are not read.
    expect(it0.calls).toEqual([]);
  });

  it('touches no port when the request is not a request', async () => {
    const it0 = recorder({ solar: ['source:solar'] });
    for (const bad of [null, 'fetch', { kind: 'source.fetch' }, { kind: 'nope', source: 'solar' }]) {
      const reply = await it0.serve('solar', bad);
      expect(reply.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(it0.calls).toEqual([]);
  });

  it('refuses an extension that is not loaded, without naming a grant', async () => {
    const it0 = recorder();
    const reply = await it0.serve('not-installed', { kind: 'extension.info' });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toContain('not a loaded application');
    expect(reply.ok === false && reply.refused).toBeUndefined();
    expect(it0.calls).toEqual([]);
  });
});

describe('an allowed request reaches the one port it names', () => {
  it('reaches the credential core with exactly the values the core validated', async () => {
    const it0 = recorder({ 'qrz-lookup': ['service:qrz', 'persona:list'] });
    const reply = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', persona: 'Home station',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(reply.ok).toBe(true);
    expect(it0.calls).toEqual([
      'callService:qrz/Home station/lookup/{"callsign":"W1AW"}'
    ]);
  });

  it('resolves the source URL from the register rather than from the extension', async () => {
    const it0 = recorder({ solar: ['source:solar'] });
    const reply = await it0.serve('solar', { kind: 'source.fetch', source: 'solar' });
    expect(reply.ok).toBe(true);
    // The extension named "solar"; what was fetched is the register's URL.
    expect(it0.calls).toEqual(['fetchSource:https://services.swpc.noaa.gov/indices.json']);
  });

  it('refuses rather than fetching nothing when the register no longer has the source', async () => {
    const it0 = recorder({ solar: ['source:solar'] });
    delete (it0.deps.sources as Record<string, string>).solar;
    const reply = await it0.serve('solar', { kind: 'source.fetch', source: 'solar' });
    expect(reply.ok).toBe(false);
    expect(it0.calls, 'a missing URL must not become a fetch of undefined').toEqual([]);
  });

  it('lets an extension read its own standing with no grant and no port', async () => {
    const it0 = recorder();
    const reply = await it0.serve('bare', { kind: 'extension.info' });
    expect(reply.ok).toBe(true);
    expect(reply.ok === true && reply.kind === 'extension.info' && reply.info.grants).toEqual([]);
    expect(it0.calls).toEqual([]);
  });
});

describe('a grant is read again on every request', () => {
  it('starts working when it is allowed, with nothing reloaded', async () => {
    const it0 = recorder();
    const before = await it0.serve('qrz-lookup', { kind: 'persona.list' });
    expect(before.ok).toBe(false);

    it0.setAllowed({ 'qrz-lookup': ['persona:list'] });
    // The same serve function, the same loaded application, no restart.
    const after = await it0.serve('qrz-lookup', { kind: 'persona.list' });
    expect(after.ok).toBe(true);
    expect(it0.calls).toEqual(['personas']);
  });

  it('stops working when it is withdrawn, with nothing restarted', async () => {
    const it0 = recorder({ 'qrz-lookup': ['persona:list', 'service:qrz'] });
    expect((await it0.serve('qrz-lookup', { kind: 'persona.list' })).ok).toBe(true);

    it0.setAllowed({ 'qrz-lookup': ['persona:list'] });
    const refused = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', persona: 'Home station',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.refused).toBe('service:qrz');
    // And the grant that was left alone still works, so a withdrawal takes
    // only what it names.
    expect((await it0.serve('qrz-lookup', { kind: 'persona.list' })).ok).toBe(true);
    expect(it0.calls).toEqual(['personas', 'personas']);
  });

  it('reads the allowed set once per request, not once at load', async () => {
    // The mechanism behind the two above, asserted directly: if this were read
    // at load, withdrawal would need a restart and no test of the behaviour
    // would say why.
    const it0 = recorder({ solar: ['source:solar'] });
    const atLoad = it0.allowedReads();
    await it0.serve('solar', { kind: 'source.fetch', source: 'solar' });
    await it0.serve('solar', { kind: 'source.fetch', source: 'solar' });
    expect(it0.allowedReads() - atLoad).toBe(2);
  });
});

describe('what comes back when a port fails', () => {
  it('returns the message and no stack, because a stack can carry a secret', async () => {
    const it0 = recorder({ 'qrz-lookup': ['service:qrz'] });
    it0.deps.ports.callService = async () => {
      throw new Error('QRZ refused the stored credential.');
    };
    const reply = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', persona: 'Home station',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toBe('QRZ refused the stored credential.');
    expect(JSON.stringify(reply)).not.toContain('at ');
  });
});

describe('the inventory the core shows itself', () => {
  it('says what each application asked for and whether it is held', () => {
    const deps = recorder({ 'qrz-lookup': ['persona:list'] }).deps;
    const inventory = buildInventory(deps);
    const lookup = inventory.extensions.find(extension => extension.id === 'qrz-lookup');
    expect(lookup?.grants.map(grant => [grant.id, grant.held])).toEqual([
      ['service:qrz', false],
      ['persona:list', true]
    ]);
    // A grant needing nobody is held without being allowed.
    const solar = inventory.extensions.find(extension => extension.id === 'solar');
    expect(solar?.grants.every(grant => grant.held || grant.needsOperator)).toBe(true);
    // Every grant carries the sentence the register holds, because a grant
    // with no explanation cannot be put to anybody.
    for (const extension of inventory.extensions) {
      for (const grant of extension.grants) expect(grant.what.length).toBeGreaterThan(0);
    }
  });
});
