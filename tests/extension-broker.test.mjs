// SPDX-License-Identifier: GPL-3.0-only
// The parts of the app runtime that read disk, and the bridge's one job.
//
// Separate from tests/extension-runtime.test.ts, which covers the decision. These
// cover the two things either side of it: what is read before an extension
// loads, and what crosses when it calls.
//
// extension-broker.ts itself is not imported here — it imports Electron, which is
// not available to a unit test. That is why `readSourceRegister` and
// `readManifests` live in extension-runtime.ts: a pure function behind an Electron
// import is a pure function nothing can exercise.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readManifests, readSourceRegister } from '../packages/main/extension-runtime.js';
import { plainRequest } from '../packages/extension-api/bridge.js';
import { validateRequest } from '../packages/extension-api/api-contract.js';

let root;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'qg-extension-broker-'));
  const extension = async (name, manifest) => {
    await mkdir(join(root, 'extensions', name), { recursive: true });
    if (manifest !== undefined) {
      await writeFile(join(root, 'extensions', name, 'manifest.json'),
        typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    }
  };
  await extension('good', { id: 'good', name: 'Good', manifestVersion: 1, tier: 'official', version: '1.0.0', engines: { qgd: '^1.0.0' }, grants: [], page: 'P.svelte' });
  await extension('broken', '{ not json');
  // A directory with no manifest at all: a working tree with a stray folder in
  // it, which is not an error.
  await extension('empty', undefined);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('reading manifests from disk', () => {
  it('reads what is there and reports what cannot be parsed', async () => {
    const found = await readManifests([join(root, 'extensions')]);
    const byName = Object.fromEntries(found.map(entry => [entry.source.split(/[\\/]/).at(-2), entry]));
    expect(Object.keys(byName).sort()).toEqual(['broken', 'good']);
    expect(byName.good.value).toMatchObject({ id: 'good' });
    // Reported rather than skipped: an extension that silently fails to
    // appear is harder to diagnose than one that says why (QGD-APP-0011).
    expect(byName.broken.value).toHaveProperty('__unreadable');
  });

  it('treats a directory that is not there as no extensions', async () => {
    // The ordinary case on a release: apps/ is empty until QGD-PRT-0108 and
    // `apps/` is empty until QGD-PRT-0108.
    expect(await readManifests([join(root, 'nowhere')])).toEqual([]);
    expect(await readManifests([])).toEqual([]);
  });

  it('skips a directory with no manifest rather than inventing one', async () => {
    const found = await readManifests([join(root, 'extensions')]);
    expect(found.some(entry => entry.source.includes('/empty/'))).toBe(false);
  });
});

describe('the source register', () => {
  it('accepts HTTPS sources and names them', async () => {
    const file = join(root, 'sources.json');
    await writeFile(file, JSON.stringify({ sources: { solar: 'https://example.invalid/a.json' } }));
    expect((await readSourceRegister(file)).sources).toEqual({ solar: 'https://example.invalid/a.json' });
  });

  it('refuses anything that is not HTTPS, or is not a register', async () => {
    const file = join(root, 'bad.json');
    for (const [content, why] of [
      [JSON.stringify({ sources: { solar: 'http://example.invalid/a.json' } }), 'plain HTTP'],
      [JSON.stringify({ sources: { solar: 'file:///etc/passwd' } }), 'a file URL'],
      [JSON.stringify({ sources: { solar: 42 } }), 'not a string'],
      [JSON.stringify({ nope: {} }), 'no sources'],
      [JSON.stringify([]), 'not an object']
    ]) {
      await writeFile(file, content);
      await expect(readSourceRegister(file), why).rejects.toThrow();
    }
  });
});

describe('what crosses when an extension calls', () => {
  // QGD-APP-0003: a value, not a reference. This is the function that makes it
  // true, and it exists because of a real failure: an extension built with
  // Svelte holds its state in a Proxy, a Proxy cannot be structure-cloned over
  // IPC, and every call made from a component's own state failed with "An
  // object could not be cloned" while the same request written as a literal
  // worked.
  it('survives a Proxy, which a structured clone would not', () => {
    const proxied = new Proxy(
      { kind: 'source.fetch', source: 'solar' },
      { get: (target, key) => target[key] }
    );
    const plain = plainRequest(proxied);
    expect(plain).toEqual({ kind: 'source.fetch', source: 'solar' });
    // The point of the exercise: the result can actually be cloned.
    expect(() => structuredClone(plain)).not.toThrow();
    expect(structuredClone(plain)).toEqual({ kind: 'source.fetch', source: 'solar' });
  });

  it('carries the contract’s fields and nothing an extension attached', () => {
    const plain = plainRequest({
      kind: 'service.request',
      service: 'qrz', persona: 'KI7MT', operation: 'lookup',
      parameters: { callsign: 'W1AW' },
      // Not in the contract. Constructed per kind rather than copied, so this
      // cannot ride along.
      secret: 'should not travel',
      onDone: () => undefined
    });
    expect(Object.keys(plain).sort()).toEqual(['kind', 'operation', 'parameters', 'persona', 'service']);
    expect(JSON.stringify(plain)).not.toContain('should not travel');
    expect(() => structuredClone(plain)).not.toThrow();
  });

  it('copies an off-contract value without converting it, so the core refuses it', () => {
    // QGD-SEC-0006: rejected, never coerced. An earlier version ran each field
    // through String(), which turned `persona: 123` into the valid persona
    // name "123" — an off-contract value becoming one the core's validator
    // accepts, which could have selected that persona's credential instead of
    // being refused. Found in review.
    const plain = plainRequest({
      kind: 'service.request',
      service: 'qrz', persona: 123, operation: 'lookup',
      parameters: { callsign: 456 }
    });
    expect(plain.persona, 'the value crosses as it was, for the core to refuse').toBe(123);
    expect(plain.parameters.callsign).toBe(456);
    // And the core does refuse it, which is the half that matters.
    expect(() => validateRequest(plain)).toThrowError(/persona is not a persona name/);
  });

  it('hands an invalid parameter container over untouched, so the core refuses it', () => {
    // `request.parameters ?? {}` turned null, a number or an array into an
    // empty object, so a malformed request became one the core accepts. Found
    // in review. Only a plain object is rebuilt.
    for (const container of [null, 42, [], 'callsign=W1AW']) {
      const plain = plainRequest({
        kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup',
        parameters: container
      });
      expect(plain.parameters, JSON.stringify(container)).toEqual(container);
      expect(() => validateRequest(plain), JSON.stringify(container)).toThrowError();
    }
    // And a plain object is still rebuilt, so the Proxy problem stays fixed.
    const good = plainRequest({
      kind: 'service.request', service: 'qrz', persona: 'KI7MT', operation: 'lookup',
      parameters: new Proxy({ callsign: 'W1AW' }, {})
    });
    expect(good.parameters).toEqual({ callsign: 'W1AW' });
    expect(() => structuredClone(good)).not.toThrow();
    expect(() => validateRequest(good)).not.toThrow();
  });

  it('keeps every request kind cloneable', () => {
    const samples = [
      { kind: 'extension.info' },
      { kind: 'persona.list' },
      { kind: 'source.fetch', source: 'solar' },
      { kind: 'service.request', service: 'qrz', persona: 'a', operation: 'lookup', parameters: {} }
    ];
    for (const sample of samples) {
      const plain = plainRequest(sample);
      expect(plain.kind, JSON.stringify(sample)).toBe(sample.kind);
      expect(() => structuredClone(plain), JSON.stringify(sample)).not.toThrow();
    }
  });
});
