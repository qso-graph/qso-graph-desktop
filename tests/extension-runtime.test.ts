// SPDX-License-Identifier: GPL-3.0-only
// P7-manifest-is-data, P7-no-grant-no-capability, P7-grant-withdrawn, and the
// gate of QGD-APP-0014 in the part that does not need a window.
//
// Written as refusals rather than as a clean run. The exit gate is "an
// application without a grant is refused", and a permission system is worth
// exactly what it says no to — so every requirement below is shown by asking
// for something and being turned down, with the sentence the operator would
// see asserted too, because QGD-APP-0011 makes the words part of the
// requirement rather than a nicety.
import { readFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUEST_KINDS, RequestError, requiredGrant, validateRequest, type ExtensionRequest
} from '../packages/extension-api/api-contract.js';
import { LOADABLE_TIERS, TIERS, ManifestError, validateManifest } from '../packages/extension-api/manifest.js';
import { RegisterError, grantIds, validateGrantRegister } from '../packages/extension-api/grants.js';
import { extensionInfo, decide, loadExtensions, readManifests, withGrants } from '../packages/main/extension-runtime.js';
import { extensionDirectories } from '../packages/main/extension-directories.js';
import { sourceFixtures } from '../packages/main/source-fixtures.js';

const register = validateGrantRegister(JSON.parse(await readFile('data/extension-grants.json', 'utf8')));
const known = grantIds(register);

const SOLAR = { id: 'solar', name: 'Space weather', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: ['source:solar'], page: 'SolarPage.svelte' };
const QRZ = { id: 'qrz-lookup', name: 'Callsign lookup', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: ['service:qrz', 'persona:list'], page: 'LookupPage.svelte' };
const BARE = { id: 'bare', name: 'Nothing at all', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: [], page: 'Bare.svelte' };

// Read from the package's own directory, as every official extension must be
// (QGD-APP-0017); P8-provenance below covers one that was not.
const from = (...values: unknown[]) => values.map((value, at) => ({ source: `extensions/${at}/manifest.json`, value, shipped: true }));

describe('a manifest is read before any code is', () => {
  it('accepts a well-formed one and keeps exactly what it declared', () => {
    const manifest = validateManifest(SOLAR, known);
    // What it declared, with the parts it left out filled in as empty rather
    // than invented (QGD-APP-0019).
    expect(manifest).toEqual({ ...SOLAR, contributes: { cards: [] }, activationEvents: [] });
  });

  it('refuses a grant this product does not define, and names it', () => {
    // QGD-APP-0006: the set is closed. The refusal names the grant, because a
    // refusal nobody can read is a refusal nobody can act on.
    const invented = { ...SOLAR, grants: ['engine:every-schema'] };
    expect(() => validateManifest(invented, known))
      .toThrowError(/asks for "engine:every-schema", which is not a grant this product defines/);
    try { validateManifest(invented, known); } catch (error) {
      expect((error as ManifestError).subject).toBe('engine:every-schema');
    }
  });

  it('refuses a tier this release cannot sandbox, rather than running it', () => {
    // QGD-APP-0004 fails closed. This is the one that matters most: the
    // alternative is a release that runs third-party code with the core's
    // own access, which is what D-2 was decided to prevent.
    for (const tier of TIERS.filter(entry => !LOADABLE_TIERS.includes(entry))) {
      expect(() => validateManifest({ ...SOLAR, tier }, known))
        .toThrowError(/the sandbox a contributed or unofficial extension needs is not built yet/);
    }
    // And the control: the tier that is loadable loads.
    expect(validateManifest({ ...SOLAR, tier: 'official' }, known).tier).toBe('official');
  });

  it('refuses a page that points outside the extension', () => {
    for (const page of ['../../packages/main/main.js', '/etc/passwd', 'a/../../b', '']) {
      expect(() => validateManifest({ ...SOLAR, page }, known), page)
        .toThrowError(/names a page that points outside itself/);
    }
  });

  it('refuses a malformed id, version, name or grant list', () => {
    expect(() => validateManifest({ ...SOLAR, id: 'Solar' }, known)).toThrowError(/well-formed id/);
    expect(() => validateManifest({ ...SOLAR, version: 'latest' }, known)).toThrowError(/well-formed version/);
    expect(() => validateManifest({ ...SOLAR, name: '' }, known)).toThrowError(/no name to show/);
    expect(() => validateManifest({ ...SOLAR, grants: 'source:solar' }, known))
      .toThrowError(/an empty list is how an extension asks for none/);
    expect(() => validateManifest({ ...SOLAR, grants: ['source:solar', 'source:solar'] }, known))
      .toThrowError(/twice/);
  });

  it('accepts an extension that asks for nothing', () => {
    // Not an error: QGD-APP-0005 says an extension starts with nothing and
    // can still draw its page.
    expect(validateManifest(BARE, known).grants).toEqual([]);
  });
});

describe('loading reports every refusal rather than the first', () => {
  it('loads what is good and refuses what is not, in one pass', () => {
    const result = loadExtensions(from(SOLAR, { ...QRZ, tier: 'unofficial' }, BARE, 'not an object'), register);
    expect(result.loaded.map(extension => extension.manifest.id)).toEqual(['solar', 'bare']);
    expect(result.refused).toHaveLength(2);
    expect(result.refused[0].subject).toBe('unofficial');
    expect(result.refused[0].source).toBe('extensions/1/manifest.json');
    expect(result.refused[1].reason).toMatch(/not an object/);
  });

  it('refuses a second application claiming an id, naming what it collided with', () => {
    // Two extensions with one id would share a schema and a role
    // (QGD-ENG-0010) and a set of grants.
    const result = loadExtensions(from(SOLAR, SOLAR), register);
    expect(result.loaded).toHaveLength(1);
    expect(result.refused[0].reason).toBe('"solar" is already loaded from extensions/0/manifest.json.');
  });

  it('gives an official extension what it declares, unless the settings file takes grants back (QGD-APP-0012.1)', () => {
    // A fresh profile: an official extension's grants are what it is, and are
    // not put to the operator, so it holds them all.
    const fresh = loadExtensions(from(SOLAR, QRZ), register);
    expect(fresh.loaded[0].held).toEqual(['source:solar']);
    expect(fresh.loaded[1].held).toEqual(['service:qrz', 'persona:list']);
    // Taken back in the settings file: once it lists grants for an extension,
    // that list is what it holds, and a grant that needs the operator and is
    // not on it is withheld.
    const restricted = loadExtensions(from(SOLAR, QRZ), register, { 'qrz-lookup': [] });
    expect(restricted.loaded[1].held).toEqual([]);
    expect(restricted.loaded[1].manifest.grants).toEqual(['service:qrz', 'persona:list']);
    // A grant that needs nobody stays held even then.
    expect(loadExtensions(from(SOLAR), register, { solar: [] }).loaded[0].held).toEqual(['source:solar']);
  });
});

describe('the decision', () => {
  const { loaded } = loadExtensions(from(SOLAR, QRZ, BARE), register, { 'qrz-lookup': ['service:qrz', 'persona:list'] });
  const [solar, qrz, bare] = loaded;

  it('lets an extension read its own standing with no grant at all', () => {
    // QGD-APP-0005. The only request that needs nothing, and it has to, or an
    // application cannot say why it stopped working.
    expect(decide(bare, { kind: 'extension.info' }, register)).toEqual({ allowed: true });
    expect(extensionInfo(bare).grants).toEqual([]);
  });

  it('refuses every capability an extension with nothing did not ask for', () => {
    const requests: ExtensionRequest[] = [
      { kind: 'persona.list' },
      { kind: 'source.fetch', source: 'solar' },
      { kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup', parameters: {} }
    ];
    for (const request of requests) {
      const decision = decide(bare, request, register);
      expect(decision.allowed, request.kind).toBe(false);
      if (!decision.allowed) {
        expect(decision.refused).toBe(requiredGrant(request));
        expect(decision.why).toMatch(/which it did not declare/);
      }
    }
  });

  it('allows what was asked for and allowed, and refuses the same call once it is withdrawn', () => {
    // P7-grant-withdrawn, and half of QGD-APP-0014's gate: the granted
    // application works, and the same call is refused with the grant gone.
    const lookup: ExtensionRequest = { kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup', parameters: { callsign: 'W1AW' } };
    expect(decide(qrz, lookup, register)).toEqual({ allowed: true });

    const withdrawn = withGrants(qrz, register, { 'qrz-lookup': ['persona:list'] });
    const decision = decide(withdrawn, lookup, register);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.refused).toBe('service:qrz');
      // It declared it, so the sentence says it has not been allowed — which
      // is the fixable case, and reads differently from the one that is not.
      expect(decision.why).toBe('"Callsign lookup" needs service:qrz, which has not been allowed.');
    }
    // And no restart: the same application object is still allowed what it
    // still holds.
    expect(decide(withdrawn, { kind: 'persona.list' }, register)).toEqual({ allowed: true });
  });

  it('names a capability that does not exist as missing rather than unallowed', () => {
    // Otherwise the operator is told a grant has not been allowed, which
    // invites them to go and allow something that cannot exist.
    const decision = decide(solar, { kind: 'source.fetch', source: 'invented' }, register);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.why).toMatch(/which is not a capability this product has/);
  });

  it('gates every request kind the contract has, not the ones somebody thought of', () => {
    // The guarantee behind requiredGrant being one function: a kind added to
    // the contract with no entry would reach the core ungated, which is how
    // four gates in this project have gone quiet (QGD-SEC-0021).
    const sample: Record<string, ExtensionRequest> = {
      'extension.info': { kind: 'extension.info' },
      'persona.list': { kind: 'persona.list' },
      'persona.active': { kind: 'persona.active' },
      'station.active': { kind: 'station.active' },
      'source.fetch': { kind: 'source.fetch', source: 'solar' },
      'service.request': { kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup', parameters: {} }
    };
    expect(Object.keys(sample).sort()).toEqual([...REQUEST_KINDS].sort());
    for (const kind of REQUEST_KINDS) {
      const request = sample[kind];
      // Either it needs a grant, or it is extension.info. Nothing else may be free.
      if (kind === 'extension.info') expect(requiredGrant(request)).toBeUndefined();
      else expect(requiredGrant(request), kind).toBeTypeOf('string');
      // And an extension holding nothing is refused everything but extension.info.
      expect(decide(bare, request, register).allowed, kind).toBe(kind === 'extension.info');
    }
  });
});

describe('a request is validated and never coerced', () => {
  it('refuses a request that is not one, naming the field', () => {
    const bad: [unknown, string][] = [
      [null, 'a request is not an object'],
      [{}, 'a request has no kind'],
      [{ kind: 'engine.query' }, '"engine.query" is not a request this product serves'],
      [{ kind: 'source.fetch' }, 'source is not a registered source name'],
      [{ kind: 'source.fetch', source: 'https://example.invalid' }, 'source is not a registered source name'],
      [{ kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'LOOKUP' }, 'operation is not an operation name'],
      [{ kind: 'service.request', service: 'qrz', persona: '', operation: 'lookup' }, 'persona is not a persona name']
    ];
    for (const [value, message] of bad) {
      expect(() => validateRequest(value), JSON.stringify(value)).toThrowError(message);
    }
  });

  it('bounds the one part of a request the extension shapes', () => {
    const base = { kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup' };
    expect(validateRequest(base)).toEqual({ ...base, parameters: {} });
    expect(() => validateRequest({ ...base, parameters: { 'Call Sign': 'W1AW' } })).toThrowError(/is not a name/);
    expect(() => validateRequest({ ...base, parameters: { callsign: 'x'.repeat(513) } })).toThrowError(/bounded string/);
    const many = Object.fromEntries([...Array(17).keys()].map(at => [`p${at}`, 'x']));
    expect(() => validateRequest({ ...base, parameters: many })).toThrowError(/too many parameters/);
  });

  it('keeps the field name on the error, so a refusal can say which part was wrong', () => {
    try { validateRequest({ kind: 'source.fetch', source: 'NOT A NAME' }); } catch (error) {
      expect((error as RequestError).field).toBe('source');
    }
  });
});

describe('the grant register', () => {
  it('is the only place a grant is named', async () => {
    // QGD-APP-0006 and the rule QGD-PSN-0002 set for services: a second list
    // is a list that will disagree with the first. No grant id is written into
    // the contract or the runtime.
    for (const file of ['packages/extension-api/grants.ts', 'packages/extension-api/manifest.ts', 'packages/main/extension-runtime.ts']) {
      const text = await readFile(file, 'utf8');
      const code = text.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
      for (const grant of register.grants) {
        expect(code, `${file} writes "${grant.id}" into the code`).not.toContain(`'${grant.id}'`);
      }
    }
    // requiredGrant builds a grant id from the request, which is how the one
    // place that decides stays free of the list: source:<name>, service:<name>.
    expect(requiredGrant({ kind: 'source.fetch', source: 'solar' })).toBe('source:solar');
  });

  it('refuses a register that would let a grant be put to nobody', () => {
    // Every grant says what it permits, because QGD-APP-0012 shows it to the
    // operator and asks them to allow it.
    expect(() => validateGrantRegister({ register: 'x', note: 'y', grants: [{ id: 'a:b', what: 'too short', needsOperator: true }] }))
      .toThrowError(RegisterError);
    expect(() => validateGrantRegister({ register: 'x', note: 'y', grants: [] })).toThrowError(/empty/);
    expect(() => validateGrantRegister({ register: 'x', note: 'y', grants: [{ id: 'bad id', what: 'a'.repeat(30), needsOperator: true }] }))
      .toThrowError(/a grant is "area:name"/);
  });

  it('says of every grant it ships whether the operator has to allow it', () => {
    // Not vacuous: there is at least one of each, because the two paths
    // through heldGrants are both live.
    expect(register.grants.some(grant => grant.needsOperator)).toBe(true);
    expect(register.grants.some(grant => !grant.needsOperator)).toBe(true);
    for (const grant of register.grants) expect(grant.what.length).toBeGreaterThan(20);
  });
});

describe('persona.active (QGD-CRD-0010)', () => {
  it('needs the same grant as the persona list, because it is the same information', () => {
    expect(requiredGrant({ kind: 'persona.active' })).toBe('persona:list');
  });
});

describe('a request is exactly its fields (QGD-SEC-0006)', () => {
  it.each([
    { kind: 'station.active', station: 'other' },
    { kind: 'persona.active', name: 'x' },
    { kind: 'extension.info', grants: ['all'] },
    { kind: 'source.fetch', source: 'solar', url: 'https://example.invalid' },
    { kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup', parameters: {}, secret: 'x' },
    JSON.parse('{"kind":"station.active","__proto__":{"x":1}}')
  ])('refuses %j rather than dropping what it does not take', (value) => {
    expect(() => validateRequest(value)).toThrowError(/takes no/);
  });

  it('still takes each kind with exactly its own fields', () => {
    expect(validateRequest({ kind: 'station.active' })).toEqual({ kind: 'station.active' });
    expect(validateRequest({ kind: 'source.fetch', source: 'solar' })).toEqual({ kind: 'source.fetch', source: 'solar' });
  });
});

describe('station.active (QGD-STN-0003, QGD-HOM-0009)', () => {
  it('needs its own grant, which the register names and says never carries the address', () => {
    expect(requiredGrant({ kind: 'station.active' })).toBe('station:active');
    const grant = register.grants.find((entry: { id: string }) => entry.id === 'station:active');
    expect(grant?.notWhat).toMatch(/street, city or postal code/);
  });
});

describe('P8-provenance: official only when shipped in the package (QGD-APP-0017)', () => {
  it('loads an official extension read from the package', () => {
    expect(loadExtensions(from(SOLAR), register).loaded.map(entry => entry.manifest.id)).toEqual(['solar']);
  });

  it('refuses the same extension read from anywhere else, whatever its manifest says', () => {
    for (const shipped of [false, undefined]) {
      const result = loadExtensions([{ source: 'elsewhere/solar/manifest.json', value: SOLAR, shipped }], register);
      expect(result.loaded).toEqual([]);
      expect(result.refused[0].reason).toMatch(/not shipped with QSO Graph Desktop/);
    }
  });

  it('marks what it reads as shipped only when the caller says the directory is the package\'s', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qgd-provenance-'));
    try {
      mkdirSync(join(root, 'solar'));
      writeFileSync(join(root, 'solar', 'manifest.json'), JSON.stringify(SOLAR));
      expect((await readManifests([root]))[0].shipped).toBe(false);
      expect((await readManifests([root], true))[0].shipped).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never reads another directory in a packaged application, and reads the package\'s in both', () => {
    const appPath = join('app', 'root');
    expect(extensionDirectories(true, appPath, join('tmp', 'mine'))).toEqual({ shipped: [join(appPath, 'dist', 'extensions')], others: [] });
    expect(extensionDirectories(false, appPath, 'a:b')).toEqual({ shipped: [join(appPath, 'dist', 'extensions')], others: ['a', 'b'] });
    expect(extensionDirectories(false, appPath, undefined).others).toEqual([]);
  });
});

describe('recorded responses for the suites, never in a package', () => {
  it('is off in a packaged application and when no directory is named', () => {
    expect(sourceFixtures(true, 'tests/fixtures/noaa/quiet')).toBeUndefined();
    expect(sourceFixtures(false, undefined)).toBeUndefined();
  });

  it('answers a source from the file its URL names, and nothing outside the directory', async () => {
    const recorded = sourceFixtures(false, join('tests', 'fixtures', 'noaa', 'quiet'))!;
    const flux = await recorded('https://services.swpc.noaa.gov/products/summary/10cm-flux.json');
    expect(JSON.parse(flux.body)).toBeTruthy();
    await expect(recorded('https://services.swpc.noaa.gov/products/%2e%2e%2fexpected.json')).rejects.toThrow();
    await expect(recorded('https://services.swpc.noaa.gov/products/')).rejects.toThrow();
  });
});
