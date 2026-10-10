// SPDX-License-Identifier: GPL-3.0-only
// QGD-PRT-0103: "screenshot baselines approved by KI7MT".
//
// A baseline is what the product is supposed to look like, so approving one
// is a judgement about what a user sees. An agent captures and compares; it
// does not decide. This holds the register to the images, so "approved" can
// never quietly come to mean "an agent wrote the file".
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const register = JSON.parse(await readFile('data/baseline-approval.json', 'utf8'));
const files = (await readdir('baselines')).filter(name => name.endsWith('.png')).sort();
const hashOf = async name =>
  createHash('sha256').update(await readFile(join('baselines', name))).digest('hex');

describe('who approved what', () => {
  it('accounts for every baseline, as approved or as awaiting', async () => {
    expect(files.length, 'there are baselines to account for').toBeGreaterThan(0);
    const approved = new Set(register.approved.flatMap(entry => Object.keys(entry.files ?? {})));
    const awaiting = new Set(Object.keys(register.awaiting.files ?? {}));
    for (const file of files) {
      expect(approved.has(file) || awaiting.has(file), `${file} is in neither list`).toBe(true);
    }
  });

  it('records the bytes, so a baseline cannot change under an approval', async () => {
    // The point of the hash: approving an image and then replacing it is the
    // way an unapproved screen becomes an approved one without anyone
    // looking.
    const pending = new Set(Object.keys(register.awaiting.files ?? {}));
    for (const entry of register.approved) {
      for (const [file, hash] of Object.entries(entry.files ?? {})) {
        // A file openly recorded as awaiting is the opposite of a silent
        // swap, and its own hash is checked below. Without this exemption a
        // legitimate change to an approved screen could never land until
        // KI7MT happened to be at the keyboard, which is not what this check
        // is protecting against — and the approval itself is still his: the
        // awaiting entry says plainly that nobody has looked yet.
        if (pending.has(file)) continue;
        expect(await hashOf(file), `${file} has changed since ${entry.by} approved it`).toBe(hash);
      }
    }
    for (const [file, hash] of Object.entries(register.awaiting.files ?? {})) {
      expect(files, `${file} is recorded as awaiting and is not there`).toContain(file);
      expect(await hashOf(file), `${file} has changed since it was recorded as awaiting`).toBe(hash);
    }
  });

  it('cannot hide a change by listing a file as awaiting without recording its bytes', async () => {
    // The exemption above is only safe because an awaiting entry carries the
    // hash of what is actually on disk. A file listed as awaiting with no
    // hash, or a stale one, would be a way to change an approved screen and
    // silence the check — so that is asserted directly rather than relied on.
    for (const [file, hash] of Object.entries(register.awaiting.files ?? {})) {
      expect(typeof hash, `${file} is awaiting with no recorded hash`).toBe('string');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashOf(file), `${file} does not match the bytes recorded as awaiting`).toBe(hash);
    }
  });

  it('says only KI7MT approved anything', () => {
    for (const entry of register.approved) {
      expect(entry.by, 'approval is KI7MT’s (QGD-PRT-0103)').toBe('KI7MT');
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps the reason each awaiting baseline changed', () => {
    const awaiting = Object.keys(register.awaiting.files ?? {});
    if (awaiting.length === 0) return;
    // A list of files nobody can account for is a list nobody can approve.
    expect(register.awaiting.whyTheyChanged.length,
      'what changed has to be readable before it can be approved').toBeGreaterThan(0);
    for (const reason of register.awaiting.whyTheyChanged) expect(reason.length).toBeGreaterThan(40);
  });
});
