// SPDX-License-Identifier: GPL-3.0-only
// Fetches ADIF's published resources archive, and verifies it.
//
// QGD-REF-0003. Run by `make setup`. The hash is checked against
// data/reference-sources.json before anything is unpacked, so a changed or
// substituted archive never reaches the disk as data this product will build a
// validator out of.
//
// Cached the same way the PostgreSQL build is, and verified the same way
// whether it came from the network or the cache — a cache trusted because it
// is a cache is a way of skipping the check that matters.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { releaseDirectory, verifyRelease } from './adif-release.mjs';

const sources = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const release = sources.adif;
const target = releaseDirectory(release);

const already = await verifyRelease(release).catch(() => undefined);
if (already?.ok && !process.argv.includes('--force')) {
  console.log(`ADIF ${release.version} is already in ${target}.`);
} else {
  const staging = await mkdtemp(join(tmpdir(), 'qg-adif-'));
  try {
    const cache = resolve('vendor', '.cache', `adif-${release.version}.zip`);
    let archive = await readFile(cache).catch(() => undefined);
    if (archive) {
      console.log(`Using the cached ADIF ${release.version} download.`);
    } else {
      console.log(`Fetching ADIF ${release.version} …`);
      const response = await fetch(release.source.url);
      if (!response.ok) throw new Error(`${release.source.url} answered ${response.status}`);
      archive = Buffer.from(await response.arrayBuffer());
    }

    const digest = createHash('sha256').update(archive).digest('hex');
    if (digest !== release.source.sha256) {
      throw new Error(`checksum mismatch: expected ${release.source.sha256}, got ${digest}`);
    }

    await mkdir(resolve('vendor', '.cache'), { recursive: true });
    await writeFile(cache, archive);
    const zip = join(staging, 'adif.zip');
    await writeFile(zip, archive);
    const unpacked = join(staging, 'tree');
    await mkdir(unpacked, { recursive: true });
    const run = spawnSync('unzip', ['-q', '-o', zip, '-d', unpacked], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`unzip failed: ${run.stderr || run.stdout}`);

    await rm(target, { recursive: true, force: true });
    await mkdir(resolve(target, '..'), { recursive: true });
    // Moved into place only once it is whole.
    await rename(unpacked, target);
    console.log(`ADIF ${release.version} unpacked into ${target}.`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const check = await verifyRelease(release);
if (!check.ok) {
  console.error('The ADIF release is not usable:');
  for (const problem of check.problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`ADIF ${check.version}: definitions and test QSOs present: PASS`);
}
