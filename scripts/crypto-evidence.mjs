// SPDX-License-Identifier: GPL-3.0-only
// Issue #3, item 4: record the crypto module version and operational-environment
// evidence, and keep compliance claims absent until they are supported.
//
// Facts only. No claim is made or implied here; whether any claim language has
// crept into the report artifacts is checked separately by
// scripts/artifact-scan.mjs, which runs after those artifacts exist.
//
// Two different numbers are easy to confuse, so both are recorded with their
// provenance: aws-lc-fips-sys is a Rust crate at 0.14.2, and the AWS-LC library
// it builds is a different version entirely. The library version is read out of
// the module the build actually produced, and compared against the external
// CMVP register in data/cmvp-aws-lc.json. The comparison is computed, never
// asserted, and a mismatch is a recorded fact rather than a failure.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { enableTestKeychain } from './keychain-service.mjs';
import { rustcPath } from './cargo-path.mjs';

// Fixtures go to this product's test Keychain service, never beside a real
// credential, and are swept on exit (QGD-CRD-0003). Called before the core is
// loaded, because the service name is read when an entry is made.
enableTestKeychain();

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
  const lock = await readFile('packages/persona-core/Cargo.lock', 'utf8');
  const locked = name => lock.match(new RegExp(String.raw`name = "${name}"\nversion = "([^"]+)"`))?.[1];
  const fromLock = locked('aws-lc-fips-sys');
  expect(fromLock, 'aws-lc-fips-sys is not in the lock file').toBeTruthy();

  // 3. The same version again, from what the addon links against.
  const linkage = run('/usr/bin/otool', ['-L', 'dist/native/persona.node']);
  const linked = linkage.match(/@loader_path\/(libaws_lc_fips_[\d_]+_crypto\.dylib)/)?.[1];
  expect(linked, 'the addon does not link the bundled crypto module by loader path').toBe(module);

  // The three must agree, or the version recorded here is not the one that runs.
  expect(fromFilename, `bundled module ${fromFilename} does not match locked ${fromLock}`).toBe(fromLock);

  // The AWS-LC library version, read from the module that was built. This is
  // not the crate version in the filename.
  const bytes = await readFile(join('dist/native', module));
  const libraryVersion = bytes.toString('latin1').match(/AWS-LC FIPS (\d+\.\d+\.\d+)/)?.[1];
  expect(libraryVersion, 'the built module does not carry an AWS-LC FIPS version string').toBeTruthy();

  const register = JSON.parse(await readFile('data/cmvp-aws-lc.json', 'utf8'));
  expect(register.validated.length, 'the CMVP register is empty, so no comparison was made').toBeGreaterThan(0);
  expect(register.buildPlatformSupport?.supportedPlatforms?.length,
    'the register carries no FIPS build platform support, so this build cannot be placed against it').toBeGreaterThan(0);
  // AWS supports FIPS builds on Linux and Windows only. This is a shared-library
  // build on macOS, which is in neither list, so it is not a FIPS build — the
  // library's own fips() self-report describes its build configuration, not a
  // supported FIPS build on this platform.
  const platformSupported = register.buildPlatformSupport.supportedPlatforms.includes(process.platform);
  const sameVersion = entry => entry.version === libraryVersion ||
    `${entry.version}.0` === libraryVersion || entry.version === libraryVersion.replace(/\.0$/, '');
  const validatedMatches = register.validated.filter(sameVersion);
  const submittedMatches = register.submittedNotYetValidated.filter(sameVersion);

  const evidence = {
    date: new Date().toISOString(),
    awsLcLibrary: {
      versionBuilt: libraryVersion,
      readFrom: `the literal string "AWS-LC FIPS ${libraryVersion}" in dist/native/${module}`,
      crateThatBuiltIt: { name: 'aws-lc-fips-sys', version: fromLock },
      note: 'The crate version and the library version are different numbers.'
    },
    fipsBuildOnThisPlatform: {
      platform: process.platform,
      isFipsBuild: platformSupported,
      statement: platformSupported
        ? 'This platform is in the supported list for FIPS builds.'
        : 'Not a FIPS build. The module is a shared library and this platform is macOS, which appears in neither the static nor the shared supported list.',
      supportedPlatforms: register.buildPlatformSupport.supportedPlatforms,
      quotedStatic: register.buildPlatformSupport.static,
      quotedShared: register.buildPlatformSupport.shared,
      source: register.source,
      retrieved: register.retrieved
    },
    cmvpComparison: {
      register: 'data/cmvp-aws-lc.json',
      registerSource: register.source,
      registerRetrieved: register.retrieved,
      versionCompared: libraryVersion,
      appearsInValidatedList: validatedMatches.length > 0,
      appearsInSubmittedList: submittedMatches.length > 0,
      matchingEntries: validatedMatches.length + submittedMatches.length,
      validatedVersionsInRegister: register.validated.map(entry => `${entry.version} (${entry.library})`),
      submittedVersionsInRegister: register.submittedNotYetValidated.map(entry => `${entry.version} (${entry.library})`)
    },
    cryptoModule: {
      name: 'AWS-LC FIPS',
      crateVersion: fromLock,
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
      assertedBy: 'packages/persona-core/src/validation.rs::tests::secure_client_requires_fips_crypto_and_only_tls13, run by the rust-unit suite: the provider and the client config both report fips(), and a real ClientHello advertises TLS 1.3 only. It builds the hello in memory and opens no connection.',
      whatFipsReportsMean: 'fips() is the library reporting the build configuration it was compiled with. It is not a statement that this is a supported FIPS build on this platform — see fipsBuildOnThisPlatform.'
    },
    transport: {
      versions: 'TLS 1.3 only',
      httpsOnly: true, proxies: false, redirects: false,
      destinations: ['https://xmldata.qrz.com/xml/current/', 'https://logbook.qrz.com/api'],
      source: 'packages/persona-core/src/validation.rs'
    },
    operationalEnvironment: {
      product: run('/usr/bin/sw_vers', ['-productName']),
      version: run('/usr/bin/sw_vers', ['-productVersion']),
      build: run('/usr/bin/sw_vers', ['-buildVersion']),
      model: run('/usr/sbin/sysctl', ['-n', 'hw.model']),
      arch: process.arch,
      cpu: run('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
      rustc: run(await rustcPath(), ['--version']),
      node: process.versions.node,
      electron: JSON.parse(await readFile('package.json', 'utf8')).devDependencies.electron,
      commit: run('git', ['rev-parse', 'HEAD']) || 'uncommitted'
    },
    scope: {
      recorded: 'what was built, from the build; where it ran, from the machine; and how both sit against AWS\'s own register',
      notRecorded: 'any module boundary, approved operational environment or certificate for this build'
    }
  };

  await mkdir('report', { recursive: true });
  await writeFile('report/crypto-evidence.json', JSON.stringify(evidence, null, 2) + '\n');

  console.log(`Crypto evidence: AWS-LC library ${libraryVersion}, built by aws-lc-fips-sys ${fromLock}, bundled and linked in agreement; rustls ${locked('rustls')}, TLS 1.3 only: PASS`);
  console.log(`CMVP register ${register.retrieved}: ${libraryVersion} in validated list = ${validatedMatches.length > 0}, in submitted list = ${submittedMatches.length > 0}`);
  console.log(`FIPS build platform support: ${process.platform} supported = ${platformSupported}${platformSupported ? '' : ' — recorded as not a FIPS build'}`);
  console.log(`Operational environment recorded: ${evidence.operationalEnvironment.product} ${evidence.operationalEnvironment.version} on ${evidence.operationalEnvironment.model}: PASS`);
} catch (error) {
  console.error('Crypto evidence failed.');
  console.error(error.message.split('\n').slice(0, 20).join('\n'));
  process.exitCode = 1;
}
