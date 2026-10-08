// SPDX-License-Identifier: GPL-3.0-only
// P4-migrations (QGD-ENG-0013): the migrations apply at start, what has been
// applied is recorded in the database, and a migration that fails stops the
// engine rather than leaving it half-migrated.
import { expect } from '@playwright/test';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { binariesDirectory } from './postgres-build.mjs';
import { initialise, start, stop } from '../dist/engine/supervisor.js';
import { chooseSocketDirectory, socketCandidates } from '../dist/engine/endpoint.js';
import { connectAsSuperuser } from '../dist/engine/roles.js';
import { applyMigrations, installation, read, recordInstallation } from '../dist/engine/migrate.js';
import { FRAME_SCHEMA } from '../dist/engine/schema.js';
import { MIGRATIONS_SCHEMA } from '../dist/engine/migrate.js';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'qg-migrate-'));
const base = join(root, 'Application Support', 'QSO Graph Desktop');
const paths = {
  binaries: join(binariesDirectory(build), 'bin'),
  data: join(base, 'data'),
  sockets: chooseSocketDirectory(socketCandidates(join(base, 'data'), join(base, 'sockets'))),
  logs: join(base, 'logs')
};
const endpoint = { kind: 'socket', directory: paths.sockets };
const folder = resolve('drizzle');
const notes = [];

try {
  await initialise(paths);
  await start(paths, endpoint);

  // ---- applied at start, and recorded in the database ---------------------
  {
    const client = await connectAsSuperuser(endpoint);
    try {
      const before = await read(client).catch(() => undefined);
      expect(before, 'nothing may be recorded before the first run').toBeUndefined();

      const applied = await applyMigrations(client, folder);
      const onDisk = (await readdir(folder)).filter(name => name.endsWith('.sql'));
      expect(applied.count, 'every migration on disk must be recorded as applied').toBe(onDisk.length);
      expect(applied.latest).toBeTruthy();
      notes.push(`${applied.count} migration(s) applied and recorded in ${MIGRATIONS_SCHEMA}.__migrations`);

      // The schema they describe is actually there.
      const table = await client.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
        [FRAME_SCHEMA, 'installation']);
      expect(table.rowCount, 'the migration must have made its table').toBe(1);

      // Applying again is a no-op: the record is what decides, not the files.
      const again = await applyMigrations(client, folder);
      expect(again.count).toBe(applied.count);
      expect(again.latest).toBe(applied.latest);
      notes.push('applying again changes nothing');

      await recordInstallation(client, build.major, build.version);
      const row = await installation(client);
      expect(row.postgresMajor).toBe(build.major);
      expect(row.createdByVersion).toBe(build.version);
      // Written once: a later start must not restate when this database was made.
      const first = row.createdAt.getTime();
      await recordInstallation(client, 99, 'something else');
      const unchanged = await installation(client);
      expect(unchanged.postgresMajor).toBe(build.major);
      expect(unchanged.createdAt.getTime()).toBe(first);
      notes.push(`the installation row records PostgreSQL ${row.postgresMajor} and is written once`);
    } finally {
      await client.end();
    }
  }

  // ---- a migration that fails stops the engine ----------------------------
  {
    // A copy of the real migrations with one more that cannot work. Run
    // against a second database, so the one above is left as it was.
    const broken = join(root, 'broken-migrations');
    await cp(folder, broken, { recursive: true });
    const journal = JSON.parse(await readFile(join(broken, 'meta', '_journal.json'), 'utf8'));
    const tag = '9999_deliberately_broken';
    await writeFile(join(broken, `${tag}.sql`), 'CREATE TABLE "qg_frame"."installation" (this_already_exists integer);\n');
    journal.entries.push({ idx: journal.entries.length, version: journal.version, when: Date.now(), tag, breakpoints: true });
    await writeFile(join(broken, 'meta', '_journal.json'), JSON.stringify(journal, null, 2));

    const client = await connectAsSuperuser(endpoint, 'postgres');
    try {
      await client.query('CREATE DATABASE second');
    } finally {
      await client.end();
    }
    const second = await connectAsSuperuser(endpoint, 'second');
    let failure;
    try {
      await applyMigrations(second, broken);
    } catch (error) {
      failure = error;
    }
    expect(failure, 'a migration that cannot run must throw, not be swallowed').toBeDefined();

    // Not half-migrated, in the strongest sense available: Drizzle applies
    // everything pending in one transaction, so a failure anywhere rolls the
    // whole run back. The database is exactly as it was — nothing recorded as
    // applied, and not even the table the first migration would have made.
    const after = await read(second);
    expect(after.count, 'a failed run must record nothing as applied').toBe(0);
    const table = await second.query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [FRAME_SCHEMA, 'installation']);
    expect(table.rowCount, 'a failed run must leave no table behind either').toBe(0);
    await second.end();
    notes.push('a migration that fails throws, and the whole run rolls back rather than half-applying');
  }

  console.log(`Engine migrations: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('Engine migrations failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  if (error.detail) console.error(redact(String(error.detail)).split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await stop(paths).catch(() => {});
  await rm(root, { recursive: true, force: true });
  await rm(paths.sockets, { recursive: true, force: true });
}
