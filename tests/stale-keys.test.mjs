// SPDX-License-Identifier: GPL-3.0-only
// What packages.qso-graph.net no longer needs is worked out as a set (#134).
// `aws s3 sync --delete` walked its listing and R2's side by side, trusting
// both to be in one order; where one key begins another, R2's was not, and
// promoting 0.5.0 deleted a dnf repository's repomd.xml as it uploaded it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { staleKeys } from '../scripts/stale-keys.mjs';

const built = [
  'rpm/aarch64/repodata/repomd.xml',
  'rpm/aarch64/repodata/repomd.xml.asc',
  'rpm/x86_64/repodata/repomd.xml',
  'rpm/x86_64/repodata/repomd.xml.asc',
  'apt/dists/stable/Release',
  'apt/dists/stable/Release.gpg',
  'apt/dists/stable/main/binary-amd64/Packages',
  'apt/dists/stable/main/binary-amd64/Packages.gz',
  'rpm/x86_64/repodata/new-primary.xml.gz'
];
// What R2 lists: last run's files too, and each pair the other way round.
const served = [
  'rpm/aarch64/repodata/repomd.xml.asc',
  'rpm/aarch64/repodata/repomd.xml',
  'rpm/x86_64/repodata/repomd.xml.asc',
  'rpm/x86_64/repodata/repomd.xml',
  'apt/dists/stable/Release.gpg',
  'apt/dists/stable/Release',
  'apt/dists/stable/main/binary-amd64/Packages.gz',
  'apt/dists/stable/main/binary-amd64/Packages',
  'rpm/x86_64/repodata/old-primary.xml.gz',
  'windows/0.2.1/qso-graph-desktop-0.2.1-win-x64.exe'
];

// sync's way, as a model: walk both lists in step, trusting them to share an
// order. Whatever R2 lists that the walk has passed in the build's list is "extra".
function inStep(local, remote) {
  const extra = [];
  let i = 0;
  for (const key of remote) {
    while (i < local.length && local[i] < key) i++;
    if (local[i] !== key) extra.push(key);
    else i++;
  }
  return extra;
}

describe('what packages.qso-graph.net no longer needs (#134)', () => {
  it('is only what the build no longer names', () => {
    expect(staleKeys(built, served)).toEqual([
      'rpm/x86_64/repodata/old-primary.xml.gz',
      'windows/0.2.1/qso-graph-desktop-0.2.1-win-x64.exe'
    ]);
  });

  it('never names a key that was built, in any order R2 lists it', () => {
    for (const order of [served, [...served].reverse(), [...served].sort()]) {
      const stale = staleKeys(built, order);
      for (const key of built) expect(stale).not.toContain(key);
    }
  });

  it('would catch the walk in step that deleted repomd.xml', () => {
    // The control: given R2's order, the side-by-side walk calls built files extra.
    const extra = inStep([...built].sort(), served);
    expect(extra).toEqual(expect.arrayContaining(['rpm/x86_64/repodata/repomd.xml', 'apt/dists/stable/Release']));
  });

  it('is what the Packages workflow uses, and sync deletes nothing there', () => {
    const workflow = readFileSync('.github/workflows/packages.yml', 'utf8');
    const commands = workflow.split('\n').filter(line => !line.trim().startsWith('#'));
    expect(commands.join('\n')).toContain('scripts/stale-keys.mjs');
    expect(commands.filter(line => line.includes('--delete'))).toEqual([]);
  });
});
