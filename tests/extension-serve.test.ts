// SPDX-License-Identifier: GPL-3.0-or-later
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
const QRZ = { id: 'qrz-lookup', name: 'Callsign lookup', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: ['service:qrz', 'callsign:list'], page: 'LookupPage.svelte' };
// An adapter and a consumer, as Integrations' are (QGD-INT-0020, QGD-INT-0021).
const WSJTX = { id: 'wsjtx', name: 'WSJT-X', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.1.0' }, grants: ['integration:receive'], main: 'main.js',
  contributes: { integration: { program: 'WSJT-X', transport: 'udp', port: 2237 } } };
const MONITOR = { id: 'monitor', name: 'Monitor', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.1.0' }, grants: ['integration:events'], main: 'main.js',
  contributes: { pages: [{ id: 'monitor', name: 'Monitor', description: 'Decodes.', refreshSeconds: 60, live: true, views: true }, { id: 'still', name: 'Still', description: 'Not live.', refreshSeconds: 60 }] } };
const LOTW = { id: 'lotw-reader', name: 'LoTW reader', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: ['lotw:read', 'lotw:manage'], page: 'Lotw.svelte' };
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
    callsigns: async () => { calls.push('callsigns'); return [{ id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', call: 'W1AW', description: 'Home station' }]; },
    activeCallsign: async () => { calls.push('activeCallsign'); return { id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', call: 'W1AW', description: 'Home station' }; },
    activeStation: async () => { calls.push('activeStation'); return { name: 'Home', grid: 'DN13sm', latitude: 43.6, longitude: -116.2 }; },
    fetchSource: async url => { calls.push(`fetchSource:${url}`); return { body: 'sfi 150', fresh: true }; },
    lotwManage: async () => { calls.push('lotwManage'); return { status: 'cancelled', certificates: [], roots: 0, signedQsos: 0, deleted: 0, locations: 0, skippedLocations: [] }; },
    lotwCertificates: async () => { calls.push('lotwCertificates'); return []; },
    lotwRoots: async () => { calls.push('lotwRoots'); return []; },
    callService: async (service, callsign, operation, parameters) => {
      calls.push(`callService:${service}/${callsign}/${operation}/${JSON.stringify(parameters)}`);
      return { outcome: 'success', call: 'W1AW' };
    },
    integrationEvents: (adapter, events, malformed) => { calls.push(`integrationEvents:${adapter}:${events.length}:${malformed}`); return 1; },
    integrationReply: async (adapter, to, bytes) => { calls.push(`integrationReply:${adapter}:${to}:${[...bytes].join(',')}`); return undefined; },
    pageChanged: (extension, page) => { calls.push(`pageChanged:${extension}/${page}`); }
  } as ExtensionBrokerPorts;
  const warnings: string[] = [];
  const deps: ServeDeps = {
    register,
    sources: { solar: 'https://services.swpc.noaa.gov/indices.json' },
    ports,
    log: { warn: (_fields, message) => warnings.push(message) },
    extensions: [...loadExtensions(
      [SOLAR, QRZ, BARE, WSJTX, MONITOR, LOTW].map((value, at) => ({ source: `extensions/${at}/manifest.json`, value, shipped: true })),
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
  it('touches no port when the grant was taken back', async () => {
    // Withdrawn in the settings file: an official extension holds its grants
    // by default (QGD-APP-0012.1), so this is how one is withheld.
    const it0 = recorder({ 'qrz-lookup': [] });
    const reply = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', callsign: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.refused).toBe('service:qrz');
    // The point of the whole area: no credential was reached.
    expect(it0.calls, 'a refused call must not reach the credential core').toEqual([]);
    expect(it0.warnings.join(' ')).toContain('service:qrz');
  });

  it('touches no port when the extension never declared the grant', async () => {
    const it0 = recorder({ bare: ['callsign:list'] });
    const reply = await it0.serve('bare', { kind: 'callsign.list' });
    expect(reply.ok).toBe(false);
    // Allowed in settings, never declared in the manifest: still refused, and
    // the callsigns are not read.
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
    const it0 = recorder({ 'qrz-lookup': ['service:qrz', 'callsign:list'] });
    const reply = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', callsign: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(reply.ok).toBe(true);
    expect(it0.calls).toEqual([
      'callService:qrz/3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b/lookup/{"callsign":"W1AW"}'
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
  it('starts working when it is allowed again, with nothing reloaded', async () => {
    const it0 = recorder({ 'qrz-lookup': [] });
    const before = await it0.serve('qrz-lookup', { kind: 'callsign.list' });
    expect(before.ok).toBe(false);

    it0.setAllowed({ 'qrz-lookup': ['callsign:list'] });
    // The same serve function, the same loaded application, no restart.
    const after = await it0.serve('qrz-lookup', { kind: 'callsign.list' });
    expect(after.ok).toBe(true);
    expect(it0.calls).toEqual(['callsigns']);
  });

  it('stops working when it is withdrawn, with nothing restarted', async () => {
    const it0 = recorder({ 'qrz-lookup': ['callsign:list', 'service:qrz'] });
    expect((await it0.serve('qrz-lookup', { kind: 'callsign.list' })).ok).toBe(true);

    it0.setAllowed({ 'qrz-lookup': ['callsign:list'] });
    const refused = await it0.serve('qrz-lookup', {
      kind: 'service.request', service: 'qrz', callsign: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.refused).toBe('service:qrz');
    // And the grant that was left alone still works, so a withdrawal takes
    // only what it names.
    expect((await it0.serve('qrz-lookup', { kind: 'callsign.list' })).ok).toBe(true);
    expect(it0.calls).toEqual(['callsigns', 'callsigns']);
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
      kind: 'service.request', service: 'qrz', callsign: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
      operation: 'lookup', parameters: { callsign: 'W1AW' }
    });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error).toBe('QRZ refused the stored credential.');
    expect(JSON.stringify(reply)).not.toContain('at ');
  });
});

describe('the inventory the core shows itself', () => {
  it('says what each application asked for and whether it is held', () => {
    const deps = recorder({ 'qrz-lookup': ['callsign:list'] }).deps;
    const inventory = buildInventory(deps);
    const lookup = inventory.extensions.find(extension => extension.id === 'qrz-lookup');
    expect(lookup?.grants.map(grant => [grant.id, grant.held])).toEqual([
      ['service:qrz', false],
      ['callsign:list', true]
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

describe('Integrations\' requests (QGD-INT-0008, QGD-INT-0009, QGD-HOM-0015)', () => {
  const close = { type: 'close', source: 'WSJT-X' };
  it('takes an adapter\'s events under its own identity, and nobody else\'s', async () => {
    const { serve, calls } = recorder();
    expect(await serve('wsjtx', { kind: 'integration.events', events: [close], malformed: 2 })).toEqual({ ok: true, kind: 'integration.events', consumers: 1 });
    expect(calls).toEqual(['integrationEvents:wsjtx:1:2']);
    const refused = await serve('monitor', { kind: 'integration.events', events: [close] });
    expect(refused).toMatchObject({ ok: false, refused: 'integration:receive' });
    expect(calls).toHaveLength(1);
  });

  it('refuses an event off its shape before anything is reached', async () => {
    const { serve, calls } = recorder();
    const refused = await serve('wsjtx', { kind: 'integration.events', events: [{ ...close, extra: 1 }] });
    expect(refused.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('passes an adapter\'s one reply on as bytes, and refuses one that is not a sender', async () => {
    const { serve, calls } = recorder();
    expect(await serve('wsjtx', { kind: 'integration.reply', to: '127.0.0.1:2237', bytes: 'AQI=' })).toEqual({ ok: true, kind: 'integration.reply' });
    expect(calls).toEqual(['integrationReply:wsjtx:127.0.0.1:2237:1,2']);
    expect((await serve('wsjtx', { kind: 'integration.reply', to: 'example.invalid:2237', bytes: 'AQI=' })).ok).toBe(false);
    expect((await serve('monitor', { kind: 'integration.reply', to: '127.0.0.1:2237', bytes: 'AQI=' })).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('lets an extension say only its own live page changed', async () => {
    const { serve, calls } = recorder();
    expect(await serve('monitor', { kind: 'page.changed', page: 'monitor' })).toEqual({ ok: true, kind: 'page.changed' });
    expect((await serve('monitor', { kind: 'page.changed', page: 'still' })).ok).toBe(false);
    expect((await serve('wsjtx', { kind: 'page.changed', page: 'monitor' })).ok).toBe(false);
    expect(calls).toEqual(['pageChanged:monitor/monitor']);
  });
});

describe('LoTW read grant (QGD-LTW-0002)', () => {
  const certificate = { id: 'id', call: 'TEST', dxcc: 1, dxccName: null, qsoFirst: 'a', qsoLast: 'b', validFrom: 'c', validTo: 'd', serial: '1', hasKey: true };
  const root = { kind: 'root' as const, subject: 'subject', serial: '1', validFrom: 'a', validTo: 'b', fingerprint: 'fp', source: 'source', acceptedAt: null };
  it('loads the grant and refuses both requests before the port, including after withdrawal', async () => {
    const t = recorder();
    for (const kind of ['lotw.certificates', 'lotw.roots'] as const) {
      expect(await t.serve('bare', { kind })).toMatchObject({ ok: false, refused: 'lotw:read' });
      expect((await t.serve('lotw-reader', { kind })).ok).toBe(true);
    }
    t.calls.length = 0;
    t.setAllowed({ 'lotw-reader': [] });
    for (const kind of ['lotw.certificates', 'lotw.roots'] as const) {
      expect(await t.serve('lotw-reader', { kind })).toMatchObject({ ok: false, refused: 'lotw:read' });
    }
    expect(t.calls).toEqual([]);
  });
  it('returns only valid lists and refuses extra fields, wrong types and errors', async () => {
    const t = recorder();
    t.deps.ports.lotwCertificates = async () => [certificate];
    t.deps.ports.lotwRoots = async () => [root];
    expect(await t.serve('lotw-reader', { kind: 'lotw.certificates' })).toEqual({ ok: true, kind: 'lotw.certificates', certificates: [certificate] });
    expect(await t.serve('lotw-reader', { kind: 'lotw.roots' })).toEqual({ ok: true, kind: 'lotw.roots', roots: [root] });
    t.deps.ports.lotwCertificates = async () => [{ ...certificate, keyName: 'secret' }];
    expect((await t.serve('lotw-reader', { kind: 'lotw.certificates' })).ok).toBe(false);
    t.deps.ports.lotwCertificates = async () => [{ ...certificate, hasKey: 'yes' }] as never;
    expect((await t.serve('lotw-reader', { kind: 'lotw.certificates' })).ok).toBe(false);
    t.deps.ports.lotwRoots = async () => [{ ...root, acceptedAt: 1 }] as never;
    expect((await t.serve('lotw-reader', { kind: 'lotw.roots' })).ok).toBe(false);
    t.deps.ports.lotwRoots = async () => { throw new Error('/home/private'); };
    expect(JSON.stringify(await t.serve('lotw-reader', { kind: 'lotw.roots' }))).not.toContain('/home/private');
  });
});

describe('LoTW replies at the extension host (QGD-SEC-0006)', () => {
  const certificate = { id: 'id', call: 'TEST', dxcc: 1, dxccName: null, qsoFirst: 'a', qsoLast: 'b', validFrom: 'c', validTo: 'd', serial: '1', hasKey: false };
  it('passes an exact reply and a refusal, and nothing else', async () => {
    const { isLotwReply } = await import('../packages/extension-api/api-contract.js');
    expect(isLotwReply({ ok: true, kind: 'lotw.certificates', certificates: [certificate] }, 'lotw.certificates')).toBe(true);
    expect(isLotwReply({ ok: false, error: 'No.', refused: 'lotw:read' }, 'lotw.roots')).toBe(true);
    expect(isLotwReply({ ok: true, kind: 'lotw.certificates', certificates: [{ ...certificate, keyName: 'key:x' }] }, 'lotw.certificates')).toBe(false);
    expect(isLotwReply({ ok: true, kind: 'lotw.certificates', certificates: [certificate], path: '/x' }, 'lotw.certificates')).toBe(false);
    expect(isLotwReply({ ok: true, kind: 'lotw.roots', roots: [] }, 'lotw.certificates')).toBe(false);
    expect(isLotwReply({ ok: false, error: 'No.', stack: 'at /home' }, 'lotw.roots')).toBe(false);
  });
});

it('QGD-LTW-0002/0004/0012: manage requires its own grant and refuses extension paths and replies carrying secrets', async () => {
  const t = recorder();
  for (const kind of ['lotw.import', 'lotw.restore', 'lotw.delete'] as const) {
    const request = { kind, ...(kind === 'lotw.delete' ? { certificate: 'cert:3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b' } : {}) };
    expect(await t.serve('bare', request)).toMatchObject({ ok: false, refused: 'lotw:manage' });
    expect(await t.serve('lotw-reader', { ...request, path: '/planted/test-only.p12' })).toMatchObject({ ok: false });
    expect(t.calls).toEqual([]);
    expect(await t.serve('lotw-reader', request)).toMatchObject({ ok: true, result: { status: 'cancelled' } });
    t.calls.length = 0;
  }
  const good = await t.deps.ports.lotwManage({ kind: 'lotw.import' });
  for (const field of ['key', 'password', 'email', 'bytes', 'path']) {
    t.deps.ports.lotwManage = async () => ({ ...good, [field]: 'planted-private' });
    const reply = await t.serve('lotw-reader', { kind: 'lotw.import' });
    expect(reply.ok).toBe(false);
    expect(JSON.stringify(reply)).not.toContain('planted-private');
  }
  t.deps.ports.lotwManage = async () => { throw new Error('planted-private'); };
  expect(JSON.stringify(await t.serve('lotw-reader', { kind: 'lotw.restore' }))).not.toContain('planted-private');
});

it('forwards the supervisor cancellation signal through the grant-checked manage path', async () => {
  const t = recorder(); const stop = new AbortController();
  const result = await t.deps.ports.lotwManage({ kind: 'lotw.import' });
  let received: AbortSignal | undefined;
  t.deps.ports.lotwManage = async (_request, signal) => { received = signal; return result; };
  expect((await t.serve('lotw-reader', { kind: 'lotw.import' }, stop.signal)).ok).toBe(true);
  expect(received).toBe(stop.signal);
  stop.abort(); expect(received?.aborted).toBe(true);
});
