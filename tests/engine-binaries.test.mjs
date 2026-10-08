// SPDX-License-Identifier: GPL-3.0-only
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { binariesDirectory, programPath, verifyBinaries } from '../scripts/postgres-build.mjs';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));

describe('QGD-ENG-0004 the pinned build', () => {
  it('is pinned exactly, from one place, with a hash to check it by', () => {
    expect(build.version).toMatch(/^\d+\.\d+$/);
    expect(build.major).toBe(Number(build.version.split('.')[0]));
    expect(build.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(build.source.url.startsWith('https://')).toBe(true);
    expect(build.source.url).toContain(build.version);
    expect(build.source.bytes).toBeGreaterThan(1_000_000);
  });

  it('lives in vendor, outside the repository and outside node_modules', async () => {
    const directory = binariesDirectory(build, '/somewhere');
    expect(directory).toBe(`/somewhere/vendor/postgres/${build.version}`);
    expect(programPath(build, 'pg_ctl', '/somewhere')).toBe(`/somewhere/vendor/postgres/${build.version}/bin/pg_ctl`);
    expect(await readFile('.gitignore', 'utf8')).toContain('vendor/');
  });

  it('records the client tools as absent, which the backup design rests on', () => {
    // QGD-ENG-0005. If this list ever shrinks, QGD-ENG-0011's reason for
    // copying the data directory instead of dumping it has gone away.
    expect(build.contains).toEqual(['postgres', 'initdb']);
    expect(build.absent.programs).toContain('pg_dump');
    expect(build.absent.programs).toContain('pg_restore');
  });
});

describe('QGD-SEC-0002 nothing reaches a shell', () => {
  it('runs no PostgreSQL program through pg_ctl', async () => {
    // pg_ctl builds the postmaster's command line as a string and hands it to
    // a shell. That layer is where the "Application Support" failure came
    // from, and it is the one thing QGD-SEC-0002 bans everywhere we write
    // ourselves. The supervisor spawns postgres with an argument array; this
    // is what stops pg_ctl coming back in because it is convenient.
    const { readdir, readFile } = await import('node:fs/promises');
    const offenders = [];
    for (const directory of ['src/engine', 'scripts']) {
      for (const file of await readdir(directory)) {
        if (!/\.(ts|mjs)$/.test(file)) continue;
        const text = await readFile(`${directory}/${file}`, 'utf8');
        // In a string that is run, not in a sentence about it.
        if (/['"`]pg_ctl['"`]/.test(text)) offenders.push(`${directory}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(build.presentButUnused.programs).toContain('pg_ctl');
  });
});

describe('QGD-ENG-0004 verifying what is on disk', () => {
  let root;
  const bin = () => join(root, 'vendor', 'postgres', build.version, 'bin');

  async function plant(programs, version = build.version) {
    await mkdir(bin(), { recursive: true });
    for (const name of programs) {
      const path = join(bin(), name);
      await writeFile(path, `#!/bin/sh\necho "postgres (PostgreSQL) ${version}"\n`);
      await chmod(path, 0o755);
    }
  }

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'qg-pgbuild-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('accepts a build that is what the register says it is', async () => {
    await plant(build.contains);
    const result = await verifyBinaries(build, root);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(build.version);
  });

  it('sends you to make setup when there is nothing there', async () => {
    const result = await verifyBinaries(build, root);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('make setup');
  });

  it('names a missing program rather than failing vaguely', async () => {
    await plant(['postgres']);
    const result = await verifyBinaries(build, root);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('initdb is missing');
  });

  it('refuses a program that is there but not executable', async () => {
    await plant(build.contains);
    await chmod(join(bin(), 'initdb'), 0o644);
    const result = await verifyBinaries(build, root);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('initdb is missing or not executable');
  });

  it('notices a client tool appearing, because the backup design assumes none', async () => {
    // Not a hypothetical: a later build of this artifact that did carry
    // pg_dump would make QGD-ENG-0011's whole reason for existing untrue, and
    // nothing else in the project would notice.
    await plant([...build.contains, 'pg_dump']);
    const result = await verifyBinaries(build, root);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('pg_dump is present');
    expect(result.problems.join(' ')).toContain('QGD-ENG-0005');
  });

  it('refuses a build that is not the version we pinned', async () => {
    await plant(build.contains, '16.4');
    const result = await verifyBinaries(build, root);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain(`pins ${build.version}`);
  });
});
