// SPDX-License-Identifier: GPL-3.0-only
// Fetches the one PostgreSQL build the engine runs from, and verifies it.
//
// QGD-ENG-0004. Run by `make setup`; it does nothing if the build is already
// in place and correct. The download is ~59 MB, which is why it is a setup
// step rather than something `npm ci` does for everyone who clones.
//
// The hash is checked against data/postgres-build.json before anything is
// unpacked, so a corrupted or substituted download never reaches the disk as
// an executable.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { binariesDirectory, verifyBinaries } from './postgres-build.mjs';
import { describe, trim } from './trim-postgres.mjs';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const target = binariesDirectory(build);

const already = await verifyBinaries(build).catch(() => undefined);
if (already?.ok && !process.argv.includes('--force')) {
  console.log(`PostgreSQL ${build.version} is already in ${target}.`);
} else {
  const staging = await mkdtemp(join(tmpdir(), 'qg-postgres-'));
  try {
    // Kept so that re-trimming, or changing what is trimmed, does not mean
    // downloading 59 MB again. It is verified below exactly as a fresh
    // download is — a cache that is trusted because it is a cache is a way of
    // skipping the check that matters.
    const cache = resolve('vendor', '.cache', `postgres-${build.version}.jar`);
    let archive = await readFile(cache).catch(() => undefined);
    if (archive) {
      console.log(`Using the cached PostgreSQL ${build.version} download.`);
    } else {
      console.log(`Fetching PostgreSQL ${build.version} …`);
      const response = await fetch(build.source.url);
      if (!response.ok) throw new Error(`${build.source.url} answered ${response.status}`);
      archive = Buffer.from(await response.arrayBuffer());
    }

    const digest = createHash('sha256').update(archive).digest('hex');
    if (digest !== build.source.sha256) {
      throw new Error(`checksum mismatch: expected ${build.source.sha256}, got ${digest}`);
    }
    if (archive.length !== build.source.bytes) {
      throw new Error(`size mismatch: expected ${build.source.bytes} bytes, got ${archive.length}`);
    }

    await mkdir(resolve('vendor', '.cache'), { recursive: true });
    await writeFile(cache, archive);
    const jar = join(staging, 'postgres.jar');
    await writeFile(jar, archive);
    // The jar is a zip holding one .txz. Both tools are on every macOS.
    const unzip = spawnSync('unzip', ['-q', '-o', jar, build.source.archive, '-d', staging], { encoding: 'utf8' });
    if (unzip.status !== 0) throw new Error(`unzip failed: ${unzip.stderr || unzip.stdout}`);
    const unpacked = join(staging, 'tree');
    await mkdir(unpacked, { recursive: true });
    const untar = spawnSync('tar', ['-xJf', join(staging, build.source.archive), '-C', unpacked], { encoding: 'utf8' });
    if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr || untar.stdout}`);

    await rm(target, { recursive: true, force: true });
    await mkdir(resolve(target, '..'), { recursive: true });
    // Moved into place only once it is complete, so a half-unpacked tree is
    // never what the supervisor finds.
    await rename(unpacked, target);
    console.log(`PostgreSQL ${build.version} unpacked into ${target}.`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Trimmed only after the hash has been checked, so what is cut down is always
// a tree already known to be what was published (QGD-ENG-0004.1).
const report = await trim(target, build);
console.log(describe(report));

const check = await verifyBinaries(build);
if (!check.ok) {
  console.error('The PostgreSQL build is not usable:');
  for (const problem of check.problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  await stat(target);
  console.log(`PostgreSQL ${check.version}: ${build.contains.join(', ')} present, ${build.absent.programs.join(', ')} absent as recorded: PASS`);
}
