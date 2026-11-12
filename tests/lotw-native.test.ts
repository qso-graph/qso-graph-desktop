// SPDX-License-Identifier: GPL-3.0-or-later
// LoTW's listings as the real native addon returns them, through the checks
// both process boundaries apply (QGD-SEC-0006). The other LoTW tests build
// these objects by hand; this one reads what napi actually produces, where a
// field with no value must arrive as null, not as a missing key (#200).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallsignCore } from '../packages/callsign-core/native.js';
import { isLotwCertificates, isLotwRoots } from '../packages/extension-api/api-contract.js';

const { CallsignCore: Core } = createRequire(import.meta.url)('../dist/native/callsign.node') as { CallsignCore: typeof CallsignCore };

let directory: string;
let core: CallsignCore;
const previous = process.env.QG_DESKTOP_TEST_KEYCHAIN;
beforeAll(() => {
  // The test store: LoTW is read from <directory>/lotw-test, never the operator's.
  process.env.QG_DESKTOP_TEST_KEYCHAIN = '1';
  directory = mkdtempSync(join(tmpdir(), 'qgd-lotw-native-'));
  core = new Core(directory);
});
afterAll(() => {
  if (previous === undefined) delete process.env.QG_DESKTOP_TEST_KEYCHAIN;
  else process.env.QG_DESKTOP_TEST_KEYCHAIN = previous;
  rmSync(directory, { recursive: true, force: true });
});

describe('LoTW listings from the native addon', () => {
  it('lists the built-in roots with acceptedAt null, and the boundary check accepts them', () => {
    const roots = core.lotwTrustedRoots();
    // An empty store lists only LoTW's built-in roots and CAs, none accepted.
    expect(roots.every(root => root.source === 'built in')).toBe(true);
    const builtIn = roots;
    expect(builtIn.length).toBeGreaterThan(0);
    for (const root of builtIn) {
      expect(Object.hasOwn(root, 'acceptedAt')).toBe(true);
      expect(root.acceptedAt).toBeNull();
    }
    expect(isLotwRoots(roots)).toBe(true);
  });

  it('passes an empty store\'s certificates through the boundary check', () => {
    expect(isLotwCertificates(core.lotwCertificates())).toBe(true);
  });
});
