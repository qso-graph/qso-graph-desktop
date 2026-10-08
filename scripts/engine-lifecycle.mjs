// SPDX-License-Identifier: GPL-3.0-only
// P4-first-run, P4-lifecycle, P4-single-copy and P4-endpoint: a real
// PostgreSQL, created, started, checked and stopped by the supervisor.
//
// Against the pinned build (QGD-ENG-0004) in a temporary data directory, never
// the operator's own database.
import { expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact } from './report.mjs';
import { binariesDirectory } from './postgres-build.mjs';
import { initialise, runningPid, start, status, stop, EngineError } from '../dist/engine/supervisor.js';
import { SOCKET_PATH_LIMIT, chooseSocketDirectory, configuration, configValue, connection, fitsSocketPath,
  freePort, isEngineLog, shortSocketDirectory, socketCandidates, socketPathLength, usesSocket } from '../dist/engine/endpoint.js';
import { connectAs, connectAsSuperuser, isApplication, newPassword, provision, roleName } from '../dist/engine/roles.js';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'qg-engine-'));
// "Application Support" is where macOS puts this, and a space in the path is
// what broke the first version of the supervisor: pg_ctl's --options is a
// string it hands to a shell, so the directory arrived at the postmaster as
// two arguments. The whole suite runs under a path with a space in it rather
// than testing that once and hoping.
const base = join(root, 'Application Support', 'QSO Graph Desktop');
const paths = {
  binaries: join(binariesDirectory(build), 'bin'),
  data: join(base, 'data'),
  sockets: join(base, 'sockets'),
  logs: join(base, 'logs')
};
// Chosen by measuring rather than assumed: this temporary path is well past
// the 103-byte limit, so the short directory is what gets used — which is the
// case a machine with a long home directory would hit in production.
paths.sockets = chooseSocketDirectory(socketCandidates(paths.data, join(base, 'sockets')));
const endpoint = { kind: 'socket', directory: paths.sockets };
const notes = [];

try {
  // ---- QGD-ENG-0009.1: the socket path has a size, and it is measured ----
  {
    const beside = join(base, 'sockets');
    expect(fitsSocketPath(beside), 'this temporary path is deliberately too long').toBe(false);
    expect(socketPathLength(beside)).toBeGreaterThan(SOCKET_PATH_LIMIT);
    expect(paths.sockets).toBe(shortSocketDirectory(paths.data));
    expect(fitsSocketPath(paths.sockets)).toBe(true);
    // Stable across starts, and not shared between two installations.
    expect(shortSocketDirectory(paths.data)).toBe(shortSocketDirectory(paths.data));
    expect(shortSocketDirectory('/somewhere/else')).not.toBe(shortSocketDirectory(paths.data));
    // A real production path fits beside the data, which is where it belongs.
    expect(fitsSocketPath('/Users/someone/Library/Application Support/QSO Graph Desktop/sockets')).toBe(true);
    let nowhere;
    try { chooseSocketDirectory(['/' + 'x'.repeat(120)]); } catch (error) { nowhere = error; }
    expect(nowhere, 'nowhere short enough must be reported, not failed as something else').toBeDefined();
    expect(String(nowhere.message)).toContain('fits in');
    notes.push(`socket directory chosen by measuring (${socketPathLength(paths.sockets)} of ${SOCKET_PATH_LIMIT} bytes)`);
  }

  // ---- P4-first-run ------------------------------------------------------
  expect(await status(paths)).toBe('no-database');
  expect(await initialise(paths)).toBe('created');
  expect(await status(paths)).toBe('stopped');
  expect(await initialise(paths)).toBe('already');
  notes.push('created on first run, and a second call is a no-op');

  // A directory that is not a database is refused rather than started on.
  {
    const other = { ...paths, data: join(root, 'not-a-database') };
    await writeFile(join(root, 'not-a-database'), '').catch(() => {});
    await rm(join(root, 'not-a-database'), { force: true });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(other.data, { recursive: true });
    await writeFile(join(other.data, 'something'), 'not a database');
    let refused;
    try { await initialise(other); } catch (error) { refused = error; }
    expect(refused, 'a directory with no PG_VERSION must be refused').toBeInstanceOf(EngineError);
    notes.push('a directory that is not a database is refused');
  }

  // ---- P4-lifecycle ------------------------------------------------------
  await start(paths, endpoint);
  expect(await status(paths)).toBe('running');
  const pid = await runningPid(paths);
  expect(typeof pid).toBe('number');
  notes.push(`started as process ${typeof pid === 'number' ? 'recorded' : 'unknown'} and reports running`);

  // ---- P4-endpoint -------------------------------------------------------
  // The socket exists where it was asked to be, and the process holds no TCP
  // port — read off the running process rather than inferred from the options
  // we passed it.
  const socket = (await readdir(paths.sockets)).filter(name => name.startsWith('.s.PGSQL'));
  expect(socket.length, 'the engine must have made its socket').toBeGreaterThan(0);
  expect((await stat(paths.sockets)).mode & 0o777).toBe(0o700);

  // lsof exits non-zero when a process holds no matching sockets, which for
  // this assertion is the answer rather than a failure — so an empty result
  // has to be told apart from lsof not running at all.
  const tcpListeners = inspected => {
    const run = spawnSync('/usr/sbin/lsof', ['-nP', '-w', '-a', '-p', String(inspected), '-iTCP'], { encoding: 'utf8' });
    if (run.error) throw new Error(`lsof could not run: ${run.error.message}`);
    if (run.status !== 0 && !run.stdout) return [];
    return (run.stdout || '').split('\n').slice(1).filter(line => line.includes('LISTEN'));
  };

  // The control, before the assertion is believed: this process opens a
  // loopback listener, and lsof has to find it. Without this, an lsof that
  // reported nothing for any process would make the check below pass on an
  // engine that was listening on every interface.
  const control = createServer();
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  const found = tcpListeners(process.pid);
  control.close();
  expect(found.length, 'lsof must find a TCP listener that is there, or finding none proves nothing').toBeGreaterThan(0);

  const listening = tcpListeners(pid);
  expect(listening, `the engine must hold no TCP port: ${listening.join(' | ')}`).toEqual([]);
  notes.push('listens on its Unix socket and holds no TCP port, with lsof proved able to see one');

  // ---- P4-single-copy ----------------------------------------------------
  let second;
  try { await start(paths, endpoint); } catch (error) { second = error; }
  expect(second, 'a second start on the same data must be refused').toBeInstanceOf(EngineError);
  expect(await status(paths)).toBe('running');
  expect(await runningPid(paths)).toBe(pid);
  notes.push('a second start on the same data is refused and the first is untouched');

  // ---- QGD-ENG-0010: one role and one schema per application ------------
  {
    const admin = await connectAsSuperuser(endpoint);
    try {
      const grant = await provision(admin, 'adif');
      expect(grant.role).toBe(roleName('adif'));
      expect(grant.password.length).toBeGreaterThan(30);
      expect(newPassword()).not.toBe(newPassword());
      expect(isApplication('adif')).toBe(true);
      expect(isApplication('../../etc')).toBe(false);

      // The whole point of the pg_hba fix: a role that is not an
      // operating-system user must be able to log in with its password. With
      // `local all all peer` first, this connection failed however correct the
      // password was, because PostgreSQL uses the first matching rule and does
      // not try the next one when authentication fails.
      const app = await connectAs(endpoint, grant);
      try {
        const who = await app.query('SELECT current_user, current_schema');
        expect(who.rows[0].current_user).toBe(grant.role);
        await app.query('CREATE TABLE a_table (id integer)');
        const where = await app.query(
          'SELECT schemaname FROM pg_tables WHERE tablename = $1', ['a_table']);
        expect(where.rows[0].schemaname, 'a table must land in the application\'s own schema').toBe(grant.schema);
        // And it may not create one where everything else can see it.
        let refused;
        try { await app.query('CREATE TABLE public.not_here (id integer)'); } catch (error) { refused = error; }
        expect(refused, 'an application must not be able to write into public').toBeDefined();
      } finally {
        await app.end();
      }

      // A wrong password is refused, which is what says the password is doing
      // anything at all.
      let rejected;
      try {
        const impostor = await connectAs(endpoint, { ...grant, password: newPassword() });
        await impostor.end();
      } catch (error) { rejected = error; }
      expect(rejected, 'a wrong password must be refused').toBeDefined();

      // Fresh at every start: provisioning again replaces it, and the old one
      // stops working.
      const again = await provision(admin, 'adif');
      expect(again.password).not.toBe(grant.password);
      let stale;
      try {
        const old = await connectAs(endpoint, grant);
        await old.end();
      } catch (error) { stale = error; }
      expect(stale, 'the previous password must stop working').toBeDefined();
      notes.push('an application role logs in with its password, lands in its own schema, and cannot touch public');
    } finally {
      await admin.end();
    }
  }

  // ---- QGD-LOG-0011: the engine logs where every other log lives ---------
  {
    const written = (await readdir(paths.logs)).filter(isEngineLog);
    expect(written.length, `the engine must log into ${paths.logs}`).toBeGreaterThan(0);
    const contents = await readFile(join(paths.logs, written[0]), 'utf8');
    expect(contents.length).toBeGreaterThan(0);
    notes.push(`logs into the managed directory (${written.length} file(s)), not into its data directory`);
  }

  // ---- stop --------------------------------------------------------------
  expect(await stop(paths)).toBe('stopped');
  expect(await status(paths)).toBe('stopped');
  expect(await stop(paths)).toBe('was-not-running');
  notes.push('stops, and stopping again is a no-op');

  // ---- the Windows path, which nobody here runs --------------------------
  const port = await freePort();
  expect(Number.isInteger(port) && port > 1024).toBe(true);
  expect(await freePort()).not.toBe(undefined);
  expect(configuration({ kind: 'port', port } && { endpoint: { kind: 'port', port }, logDirectory: paths.logs }))
    .toContain("listen_addresses = '127.0.0.1'");
  expect(configuration({ endpoint, logDirectory: paths.logs })).toContain("listen_addresses = ''");
  // A value with a quote in it is a value, not a syntax error or an escape.
  expect(configValue("it's here")).toBe("'it''s here'");
  expect(usesSocket('darwin')).toBe(true);
  expect(usesSocket('win32')).toBe(false);
  expect(connection({ kind: 'port', port }, 'qg', 'qg').host).toBe('127.0.0.1');
  expect(connection(endpoint, 'qg', 'qg').host).toBe(paths.sockets);
  notes.push(`the free-port chooser answers (${port} this run) and builds the loopback options`);

  console.log(`Engine lifecycle: PostgreSQL ${build.version} — ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('Engine lifecycle failed.');
  console.error(redact(error.message).split('\n').slice(0, 20).join('\n'));
  if (error.detail) console.error(redact(String(error.detail)).split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await stop(paths).catch(() => {});
  await rm(root, { recursive: true, force: true });
  // The short socket directory lives outside the temporary tree.
  await rm(paths.sockets, { recursive: true, force: true });
}
