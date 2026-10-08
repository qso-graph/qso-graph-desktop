// SPDX-License-Identifier: GPL-3.0-only
// P4-backup and P4-restore-refuses (QGD-ENG-0011, QGD-ENG-0012), and the half
// of QGD-PRT-0104's exit gate that says restore works.
//
// "Works" is read as: data written before the backup is readable again after
// restoring it over a database that has since changed. Anything less proves
// the files moved, not that the database came back.
import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact } from './report.mjs';
import { binariesDirectory } from './postgres-build.mjs';
import { initialise, start, status, stop, exists } from '../dist/engine/supervisor.js';
import { chooseSocketDirectory, socketCandidates } from '../dist/engine/endpoint.js';
import { connectAsSuperuser } from '../dist/engine/roles.js';
import { backup, readManifest, restore, majorOf, isManifest, verifyCopy, MANIFEST, DATA } from '../dist/engine/backup.js';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'qg-backup-'));
const base = join(root, 'Application Support', 'QSO Graph Desktop');
const paths = {
  binaries: join(binariesDirectory(build), 'bin'),
  data: join(base, 'data'),
  sockets: chooseSocketDirectory(socketCandidates(join(base, 'data'), join(base, 'sockets'))),
  logs: join(base, 'logs')
};
const endpoint = { kind: 'socket', directory: paths.sockets };
const archive = join(root, 'backup');
const notes = [];

const write = async statement => {
  const client = await connectAsSuperuser(endpoint);
  try { await client.query(statement); } finally { await client.end(); }
};
const readRows = async query => {
  const client = await connectAsSuperuser(endpoint);
  try { return (await client.query(query)).rows; } finally { await client.end(); }
};

try {
  await initialise(paths);
  await start(paths, endpoint);
  await write('CREATE TABLE kept (note text)');
  await write("INSERT INTO kept VALUES ('written before the backup')");
  await stop(paths);

  // ---- a backup is taken with the engine stopped -------------------------
  {
    const manifest = await backup(paths, archive, build.version);
    expect(isManifest(manifest)).toBe(true);
    expect(manifest.postgresMajor).toBe(build.major);
    expect(manifest.files).toBeGreaterThan(100);
    expect(await readManifest(archive)).toEqual(manifest);
    expect(await majorOf(join(archive, DATA))).toBe(build.major);
    notes.push(`backed up ${manifest.files} files, labelled PostgreSQL ${manifest.postgresMajor}`);

    // And not while it is running — attempted over the backup that already
    // exists, because QGD-ENG-0012's other half is that a failed backup must
    // not be the reason there is no backup.
    await start(paths, endpoint);
    let refused;
    try { await backup(paths, archive, build.version); } catch (error) { refused = error; }
    expect(refused, 'a backup of a running engine must be refused').toBeDefined();
    expect(await readManifest(archive), 'the backup that was there must survive a failed one').toEqual(manifest);
    expect(await exists(`${archive}.writing`), 'no half-written backup may be left behind').toBe(false);
    notes.push('a backup while the engine is running is refused, and the previous backup survives it');
  }

  // ---- the database changes, then the backup is restored over it ---------
  {
    await write("INSERT INTO kept VALUES ('written after the backup')");
    await write('CREATE TABLE added_later (id integer)');
    expect((await readRows('SELECT count(*)::int AS n FROM kept'))[0].n).toBe(2);
    await stop(paths);

    const manifest = await restore(paths, archive, build.major);
    expect(manifest.postgresMajor).toBe(build.major);
    await start(paths, endpoint);

    const rows = await readRows('SELECT note FROM kept ORDER BY note');
    expect(rows.map(row => row.note)).toEqual(['written before the backup']);
    const later = await readRows(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'added_later'");
    expect(later.length, 'what was added after the backup must be gone').toBe(0);
    notes.push('a restored database holds what it held when the backup was taken, and nothing added since');
    await stop(paths);
  }

  // ---- QGD-ENG-0012: a backup from another major is refused --------------
  {
    const foreign = join(root, 'from-another-major');
    const manifest = await readManifest(archive);
    await import('node:fs/promises').then(fs => fs.cp(archive, foreign, { recursive: true }));
    await writeFile(join(foreign, MANIFEST),
      JSON.stringify({ ...manifest, postgresMajor: build.major - 1 }, null, 2));

    let refused;
    try { await restore(paths, foreign, build.major); } catch (error) { refused = error; }
    expect(refused, 'a backup from another major must be refused').toBeDefined();
    expect(String(refused.message)).toContain(`PostgreSQL ${build.major - 1}`);

    // The database that was there is still a database, and still has its rows.
    expect(await status(paths)).toBe('stopped');
    await start(paths, endpoint);
    expect((await readRows('SELECT count(*)::int AS n FROM kept'))[0].n).toBe(1);
    await stop(paths);
    notes.push('a backup from another major is refused and the live database is untouched');
  }

  // ---- a label that disagrees with the data is refused too ---------------
  {
    const lying = join(root, 'lying');
    await import('node:fs/promises').then(fs => fs.cp(archive, lying, { recursive: true }));
    await writeFile(join(lying, DATA, 'PG_VERSION'), `${build.major - 1}\n`);
    let refused;
    try { await restore(paths, lying, build.major); } catch (error) { refused = error; }
    expect(refused, 'a manifest that disagrees with the data must be refused').toBeDefined();
    expect(String(refused.message)).toContain('does not match its own manifest');
    notes.push('a manifest that disagrees with the data it describes is refused');
  }

  // ---- QGD-ENG-0012: an incomplete backup is refused ---------------------
  {
    // The case that destroyed a working database: a copy that kept its
    // manifest and its PG_VERSION but lost a file PostgreSQL cannot start
    // without. Every other check passed it.
    const fs = await import('node:fs/promises');
    const gutted = join(root, 'missing-a-file');
    await fs.cp(archive, gutted, { recursive: true });
    await fs.rm(join(gutted, DATA, 'global', 'pg_control'));

    let refused;
    try { await restore(paths, gutted, build.major); } catch (error) { refused = error; }
    expect(refused, 'a backup missing pg_control must be refused').toBeDefined();
    expect(String(refused.message)).toContain('incomplete');

    await start(paths, endpoint);
    expect((await readRows('SELECT count(*)::int AS n FROM kept'))[0].n).toBe(1);
    await stop(paths);

    // And one that is merely short, with every essential file present.
    const shortened = join(root, 'short');
    await fs.cp(archive, shortened, { recursive: true });
    const spare = (await fs.readdir(join(shortened, DATA, 'pg_twophase'))).length === 0;
    await fs.writeFile(join(shortened, DATA, 'pg_twophase', 'an_extra_file'), 'not in the manifest');
    expect(spare, 'pg_twophase is the empty directory this adds to').toBe(true);
    let counted;
    try { await restore(paths, shortened, build.major); } catch (error) { counted = error; }
    expect(counted, 'a copy whose contents do not match the manifest must be refused').toBeDefined();
    expect(String(counted.message)).toContain('not all there');
    notes.push('a backup that is incomplete, or does not match its own counts, is refused');
  }

  // ---- housekeeping after the swap cannot fail the restore ---------------
  {
    const fs = await import('node:fs/promises');
    // A directory inside the live database that cannot be emptied. Removing
    // the replaced copy will fail on it — after the swap has committed, where
    // reporting a failure would be untrue and would send the caller into a
    // rollback that must not run.
    const locked = join(paths.data, 'qg_locked');
    await fs.mkdir(locked, { recursive: true });
    await fs.writeFile(join(locked, 'held'), 'x');
    await fs.chmod(locked, 0o500);
    try {
      const manifest = await restore(paths, archive, build.major);
      expect(manifest.postgresMajor, 'the restore committed, so it must report success').toBe(build.major);
      await start(paths, endpoint);
      expect((await readRows('SELECT count(*)::int AS n FROM kept'))[0].n).toBe(1);
      await stop(paths);
      notes.push('a restore that commits reports success even when the old copy cannot be cleared away');
    } finally {
      await fs.chmod(locked, 0o700).catch(() => {});
      await fs.chmod(join(`${paths.data}.replaced`, 'qg_locked'), 0o700).catch(() => {});
    }
  }

  // ---- a restore that fails leaves the database working ------------------
  {
    const broken = join(root, 'not-a-backup');
    await import('node:fs/promises').then(fs => fs.mkdir(broken, { recursive: true }));
    await writeFile(join(broken, MANIFEST), 'not json at all');
    let refused;
    try { await restore(paths, broken, build.major); } catch (error) { refused = error; }
    expect(refused).toBeDefined();

    await start(paths, endpoint);
    expect((await readRows('SELECT count(*)::int AS n FROM kept'))[0].n).toBe(1);
    await stop(paths);
    notes.push('a restore that fails leaves the database that was there working');
  }

  console.log(`Engine backup and restore: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('Engine backup and restore failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  if (error.detail) console.error(redact(String(error.detail)).split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await stop(paths).catch(() => {});
  await rm(root, { recursive: true, force: true });
  await rm(paths.sockets, { recursive: true, force: true });
}
