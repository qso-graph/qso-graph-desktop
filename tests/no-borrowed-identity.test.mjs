// SPDX-License-Identifier: GPL-3.0-only
// P6-no-borrowed-identity (QGD-PSN-0012).
//
// An OAuth or Cognito client identifier names the **application**, not the
// operator. Using another product's client would mean telling their sign-in
// service that QSO Graph is that product — a false identity even with the
// operator's own password and their consent, and one that leaves the service
// unable to tell our traffic from their own, rate-limit it, or revoke it.
//
// This exists because the project came within one commit of doing it. A POTA
// SRP sign-in was half specified against POTA's own web client, read out of a
// third-party crate, before KI7MT stopped it. Nothing was ever sent — but the
// way that nearly happened was gradual and reasonable-looking at each step,
// which is what a standing check is for.
//
// The checks are written so that passing them does not require naming anybody
// else's client here. A test that had to quote the identifier to forbid it
// would put it back in the tree.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { productSources } from '../scripts/network-static.mjs';
import { validateRegister } from '../src/services.js';

const cargo = await readFile('native/persona-core/Cargo.toml', 'utf8');
const register = validateRegister(JSON.parse(await readFile('data/service-profiles.json', 'utf8')));

describe('the credential core signs in as nobody else', () => {
  it('declares no AWS SDK, Cognito or SRP dependency', () => {
    // The shape of what would be needed to do it. Each of these was measured
    // and rejected: the AWS SDK at 124 crates, cognito_srp at 41 and a second
    // SHA-256 beside AWS-LC.
    const forbidden = [/aws-sdk-/i, /cognito/i, /\bsrp\b/i];
    const declared = cargo.split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .join('\n');
    for (const pattern of forbidden) {
      expect(pattern.test(declared), `Cargo.toml declares ${pattern}`).toBe(false);
    }
    // Not vacuous: the file is the one with the real dependencies in it.
    expect(declared).toContain('aws-lc-rs');
    expect(declared).toContain('keyring');
  });

  it('holds no Cognito user pool identifier in any product source', async () => {
    // The shape of a Cognito pool is region_suffix. Matching the shape rather
    // than a particular value means this catches the next one too, and names
    // nobody.
    const pool = /\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{8,}\b/;
    for (const file of await productSources()) {
      const text = await readFile(file, 'utf8');
      expect(pool.test(text), `${file} holds something shaped like a Cognito user pool`).toBe(false);
    }
  });

  it('gives no service a place to put somebody else’s client', () => {
    // The register has no field for an authentication client, and that is the
    // point: there is nowhere to put one without changing the shape on
    // purpose, which is a decision somebody has to make and defend.
    for (const service of register.services) {
      const keys = Object.keys(service);
      for (const key of keys) {
        expect(/client|oauth|cognito|pool|secret|token/i.test(key),
          `"${service.id}" has a ${key} field`).toBe(false);
      }
    }
  });

  it('has at least one service that needs no credential, and it asks for nothing', () => {
    // POTA. The alternative to borrowing an identity was not a worse sign-in,
    // it was no sign-in — which turned out to cost nothing, because
    // everything this product does with POTA works without one.
    const free = register.services.filter(service => !service.needsCredential);
    expect(free.length).toBeGreaterThan(0);
    for (const service of free) {
      expect(service.fields).toEqual([]);
      expect('none' in service.test, `${service.id} must offer no test`).toBe(true);
    }
  });
});
