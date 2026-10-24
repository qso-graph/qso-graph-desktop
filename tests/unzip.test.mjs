// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { zip } from '../packages/main/diagnostics.js';
import { entries } from '../scripts/unzip.mjs';

describe('reading back an exported archive', () => {
  it('returns what was put in, through both compression methods', () => {
    // A long repetitive line deflates; a short one does not, and zip() stores
    // it. Both have to come back, or a suite looking for a secret would be
    // searching whichever half the reader happened to handle.
    const compressible = 'a credential would sit in a line like this one\n'.repeat(200);
    const tiny = 'x';
    const archive = zip([
      { name: 'qg-desktop.log', content: Buffer.from(compressible) },
      { name: 'tiny.log', content: Buffer.from(tiny) }
    ]);
    const read = entries(archive);
    expect(read.map(file => file.name)).toEqual(['qg-desktop.log', 'tiny.log']);
    expect(read[0].method).toBe(8);
    expect(read[1].method).toBe(0);
    expect(read[0].content.toString()).toBe(compressible);
    expect(read[1].content.toString()).toBe(tiny);
  });

  it('finds in the content what the raw bytes cannot', () => {
    // The defect this module exists for, stated as a test: the secret is in
    // the archive and a byte search does not find it.
    const secret = 'QG_FAKE_CREDENTIAL_0000-1111';
    const line = JSON.stringify({ note: secret, filler: 'connection failure' }) + '\n';
    const archive = zip([{ name: 'qg-desktop.log', content: Buffer.from(line.repeat(100)) }]);
    expect(archive.includes(secret), 'a byte search is the vacuous check').toBe(false);
    expect(entries(archive)[0].content.includes(secret), 'reading the entry finds it').toBe(true);
  });

  it('reads an empty archive as no entries rather than failing', () => {
    expect(entries(zip([]))).toEqual([]);
  });

  it('refuses an entry it cannot read rather than returning it empty', () => {
    const archive = zip([{ name: 'qg-desktop.log', content: Buffer.from('hello'.repeat(500)) }]);
    // A method nothing here writes. Returning an empty buffer would make every
    // containment assertion downstream pass.
    archive.writeUInt16LE(99, 8);
    expect(() => entries(archive)).toThrow(/unsupported compression method 99/);
  });
});
