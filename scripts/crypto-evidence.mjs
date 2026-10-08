// SPDX-License-Identifier: GPL-3.0-only
// Issue #3, item 4: record the crypto module version and operational-environment
// evidence, and keep compliance claims absent until they are supported.
//
// This records what was built and where it ran. It makes no validated-module
// claim, and it asserts that none appears anywhere in the report artifacts —
// "built against AWS-LC FIPS" is a build fact; "FIPS 140-3 validated" would be a
// claim about a certificate, an operational environment and a module boundary
// that nothing here establishes. The distinction is the requirement, so it is
// checked mechanically rather than left to whoever writes the next report.
//
// The version is not transcribed from a note: it is read from the module the
// build actually bundled, from the dependency lock, and from the addon's own
// linkage, and the three must agree.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';

// Language that would assert validation, certification or an approved mode.
const COMPLIANCE_CLAIMS = [
  /FIPS\s*140(?:-[23])?\s*(?:validated|certified|compliant|approved)/i,
  /validated\s+(?:crypto(?:graphic)?\s+)?module/i,
  /CMVP|certificate\s*#\s*\d+/i,
  /FIPS\s+(?:mode\s+)?(?:certified|validated)/i,
  /meets\s+FIPS/i
];

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout || '').trim() : '';
};

try {
  // 1. The crypto module the build actually bundled.
  const native = await readdir('dist/native');
  const module = native.find(name => /^libaws_lc_fips_[\d_]+_crypto\.dylib$/.test(name));
  expect(module, 'the FIPS crypto module is not bundled beside the addon').toBeTruthy();
  const fromFilename = module.match(/fips_([\d_]+)_crypto/)[1].replaceAll('_', '.');

  // 2. The same version, from the dependency lock.
  const lock = await readFile('native/persona-core/Cargo.lock', 'utf8');
  const locked = name => lock.match(new RegExp(String.raw`name = "${name}"\nversion = "([^"]+)"`))?.[1];
  const fromLock = locked('aws-lc-fips-sys');
  expect(fromLock, 'aws-lc-fips-sys is not in the lock file').toBeTruthy();

  // 3. The same version again, from what the addon links against.
  const linkage = run('/usr/bin/otool', ['-L', 'dist/native/persona.node']);
  const linked = linkage.match(/@loader_path\/(libaws_lc_fips_[\d_]+_crypto\.dylib)/)?.[1];
  expect(linked, 'the addon does not link the bundled crypto module by loader path').toBe(module);

  // The three must agree, or the version recorded here is not the one that runs.
  expect(fromFilename, `bundled module ${fromFilename} does not match locked ${fromLock}`).toBe(fromLock);

  const evidence = {
    date: new Date().toISOString(),
    cryptoModule: {
      name: 'AWS-LC FIPS',
      version: fromLock,
      bundledAs: module,
      linkedBy: '@loader_path, so the addon loads the copy beside it',
      agreementChecked: ['bundled filename', 'Cargo.lock', 'otool linkage'],
      copiedUnchanged: 'scripts/build-native.mjs copies the module as built and relocates only the addon\'s dependency path'
    },
    cryptoStack: {
      'aws-lc-rs': locked('aws-lc-rs'),
      rustls: locked('rustls'),
      'webpki-roots': locked('webpki-roots'),
      rustlsFeatures: 'std, fips',
      assertedBy: 'native/persona-core/src/validation.rs::tests::secure_client_requires_fips_crypto_and_only_tls13, run by the rust-unit suite: the provider reports fips(), the client config reports fips(), and a real ClientHello advertises TLS 1.3 only. It builds the hello in memory and opens no connection.'
    },
    transport: {
      versions: 'TLS 1.3 only',
      httpsOnly: true, proxies: false, redirects: false,
      destinations: ['https://xmldata.qrz.com/xml/current/', 'https://logbook.qrz.com/api'],
      source: 'native/persona-core/src/validation.rs'
    },
    operationalEnvironment: {
      product: run('/usr/bin/sw_vers', ['-productName']),
      version: run('/usr/bin/sw_vers', ['-productVersion']),
      build: run('/usr/bin/sw_vers', ['-buildVersion']),
      model: run('/usr/sbin/sysctl', ['-n', 'hw.model']),
      arch: process.arch,
      cpu: run('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
      rustc: run(join(homedir(), '.cargo/bin/rustc'), ['--version']),
      node: process.versions.node,
      electron: JSON.parse(await readFile('package.json', 'utf8')).devDependencies.electron,
      commit: run('git', ['rev-parse', 'HEAD']) || 'uncommitted'
    },
    claims: {
      validatedModuleCompliance: false,
      statement: 'Built against AWS-LC FIPS and asserted to run with its FIPS provider and TLS 1.3 only. That is build and runtime evidence for this machine. It is not a validated-module claim: no certificate, module boundary or approved operational environment is established here.'
    }
  };

  await mkdir('report', { recursive: true });
  await writeFile('report/crypto-evidence.json', JSON.stringify(evidence, null, 2) + '\n');

  // No report artifact may assert validation or certification.
  const artifacts = (await readdir('report')).filter(name => /\.(md|json|txt)$/.test(name));
  const claimed = [];
  for (const name of artifacts) {
    const text = await readFile(join('report', name), 'utf8');
    for (const pattern of COMPLIANCE_CLAIMS) {
      const match = pattern.exec(text);
      if (match) claimed.push(`${name}: ${match[0]}`);
    }
  }
  expect(claimed, claimed.join('; ')).toEqual([]);
  expect(artifacts.length, 'no report artifacts were checked for compliance claims').toBeGreaterThan(0);

  // The checker must be able to see a claim, or finding none proves nothing.
  const control = COMPLIANCE_CLAIMS.some(pattern => pattern.test('this build is FIPS 140-3 validated'));
  expect(control, 'the compliance-claim checker does not recognise a claim').toBe(true);

  console.log(`Crypto evidence: AWS-LC FIPS ${fromLock} bundled, locked and linked in agreement; rustls ${locked('rustls')}, TLS 1.3 only: PASS`);
  console.log(`Operational environment recorded: ${evidence.operationalEnvironment.product} ${evidence.operationalEnvironment.version} on ${evidence.operationalEnvironment.model}. No validated-module claim in ${artifacts.length} report artifacts: PASS`);
} catch (error) {
  console.error('Crypto evidence failed.');
  console.error(error.message.split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
}
