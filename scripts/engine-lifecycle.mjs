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
import { connection, freePort, postgresOptions, usesSocket } from '../dist/engine/endpoint.js';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'qg-engine-'));
const paths = {
  binaries: join(binariesDirectory(build), 'bin'),
  data: join(root, 'data'),
  sockets: join(root, 'sockets')
};
const endpoint = { kind: 'socket', directory: paths.sockets };
const notes = [];

try {
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

  // ---- stop --------------------------------------------------------------
  expect(await stop(paths)).toBe('stopped');
  expect(await status(paths)).toBe('stopped');
  expect(await stop(paths)).toBe('was-not-running');
  notes.push('stops, and stopping again is a no-op');

  // ---- the Windows path, which nobody here runs --------------------------
  const port = await freePort();
  expect(Number.isInteger(port) && port > 1024).toBe(true);
  expect(await freePort()).not.toBe(undefined);
  expect(postgresOptions({ kind: 'port', port }).join(' ')).toContain('listen_addresses=127.0.0.1');
  expect(postgresOptions(endpoint).join(' ')).toContain('listen_addresses=');
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
}
