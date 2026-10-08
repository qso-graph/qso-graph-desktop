// SPDX-License-Identifier: GPL-3.0-only
// The engine's lifecycle: create the data directory, start, check, stop.
//
// QGD-ENG-0006. Every argument here is built by this module from the paths the
// frame chose. Nothing a user types reaches a command line, and the binaries
// are the pinned ones (QGD-ENG-0004) addressed by absolute path — the
// supervisor never resolves a program through PATH, because on a developer's
// Mac that finds a different PostgreSQL.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { postgresOptions, type Endpoint } from './endpoint.js';

export interface EnginePaths {
  // The PostgreSQL build's bin directory (QGD-ENG-0004).
  binaries: string;
  // The data directory: created on first run, and the thing a backup copies.
  data: string;
  // Where the Unix socket is put, on the platforms that use one.
  sockets: string;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export class EngineError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'EngineError';
  }
}

// A program from the pinned build, by absolute path, with an environment that
// carries no PATH at all: nothing here may fall back to the machine's own
// PostgreSQL, and a missing binary must fail loudly rather than silently
// finding another one.
export function run(paths: EnginePaths, program: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise(resolve => {
    const child = spawn(join(paths.binaries, program), args, {
      env: {
        // Keeps PostgreSQL's own messages in a language the log can be read in.
        LC_ALL: 'C',
        LANG: 'C',
        // PGDATA is not set: every call passes -D explicitly, so an inherited
        // one can never point the supervisor at somebody else's database.
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '/tmp'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    timer.unref?.();
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}${(error as Error).message}` });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

// QGD-ENG-0007: created on first run, and a creation that fails leaves nothing
// behind. initdb runs into a staging directory beside the real one and is moved
// into place only once it has succeeded — a half-made directory that the next
// start mistook for a database is the failure this shape prevents.
export async function initialise(paths: EnginePaths): Promise<'created' | 'already'> {
  if (await exists(join(paths.data, 'PG_VERSION'))) return 'already';
  if (await exists(paths.data)) {
    throw new EngineError('The data directory exists but holds no database.',
      `${paths.data} has no PG_VERSION. It was not left by a finished initdb; move it aside rather than starting on it.`);
  }

  await mkdir(dirname(paths.data), { recursive: true });
  const staging = await mkdtemp(`${paths.data}.creating-`);
  try {
    const result = await run(paths, 'initdb', [
      '--pgdata', staging,
      '--encoding', 'UTF8',
      '--locale', 'C',
      // Peer on the local socket: the operating system says who is connecting,
      // so the superuser needs no password and there is no secret to store.
      // Roles that are not an operating-system user get scram, written into
      // pg_hba.conf below.
      '--auth-local', 'peer',
      // No TCP listener exists to authenticate against; rejecting is what it
      // would mean if one ever did.
      '--auth-host', 'reject',
      '--no-sync'
    ], 180_000);
    if (!result.ok) {
      throw new EngineError('The database could not be created.', result.stderr.trim() || result.stdout.trim());
    }
    await writeHostRules(staging);
    await rename(staging, paths.data);
    return 'created';
  } finally {
    // Whether it threw or was renamed away, nothing half-made survives.
    await rm(staging, { recursive: true, force: true });
  }
}

// Written by us rather than left to initdb, because initdb sets one rule for
// local and we need two: the operating system's own user by peer, anything
// else by password, and nothing over TCP ever.
async function writeHostRules(data: string): Promise<void> {
  await writeFile(join(data, 'pg_hba.conf'),
    '# Written by the engine supervisor. QGD-ENG-0009 and QGD-ENG-0010.\n' +
    '# The operating system says who the superuser is; no password exists to steal.\n' +
    'local   all   all   peer\n' +
    '# An application role is not an operating-system user, so it proves itself.\n' +
    'local   all   all   scram-sha-256\n' +
    '# There is no TCP listener. If one is ever configured, it is refused here too.\n' +
    'host    all   all   all   reject\n',
    { mode: 0o600 });
}

// QGD-ENG-0008: the postmaster's own lock file is the authority on whether a
// database is already serving. Read rather than guessed at, because a second
// postmaster on one data directory is the way to corrupt it.
export async function runningPid(paths: EnginePaths): Promise<number | undefined> {
  let contents;
  try { contents = await readFile(join(paths.data, 'postmaster.pid'), 'utf8'); } catch { return undefined; }
  const pid = Number.parseInt(contents.split('\n')[0] ?? '', 10);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    // Signal 0 asks whether the process exists without touching it.
    process.kill(pid, 0);
    return pid;
  } catch {
    // The file outlived the process: a crash, not a running engine.
    return undefined;
  }
}

export async function status(paths: EnginePaths): Promise<'running' | 'stopped' | 'no-database'> {
  if (!await exists(join(paths.data, 'PG_VERSION'))) return 'no-database';
  return await runningPid(paths) === undefined ? 'stopped' : 'running';
}

export async function start(paths: EnginePaths, endpoint: Endpoint): Promise<void> {
  const already = await runningPid(paths);
  if (already !== undefined) {
    throw new EngineError('The engine is already running on this data directory.',
      `postmaster.pid names process ${already}, which is alive. A second one on the same data would corrupt it.`);
  }
  if (endpoint.kind === 'socket') await mkdir(endpoint.directory, { recursive: true, mode: 0o700 });

  const result = await run(paths, 'pg_ctl', [
    '--pgdata', paths.data,
    '--log', join(paths.data, 'engine.log'),
    // Waits for the postmaster to be accepting connections, so a start that
    // returns has actually started.
    '--wait',
    '--timeout', '60',
    '--options', postgresOptions(endpoint).join(' '),
    'start'
  ], 90_000);

  if (!result.ok) {
    const log = await readFile(join(paths.data, 'engine.log'), 'utf8').catch(() => '');
    throw new EngineError('The engine did not start.',
      (result.stderr.trim() || result.stdout.trim() || '') + (log ? `\n${log.trim().split('\n').slice(-8).join('\n')}` : ''));
  }
}

export async function stop(paths: EnginePaths): Promise<'stopped' | 'was-not-running'> {
  if (await runningPid(paths) === undefined) return 'was-not-running';
  // fast: roll back open transactions and exit, rather than waiting for
  // clients to disconnect on their own.
  const result = await run(paths, 'pg_ctl', [
    '--pgdata', paths.data, '--mode', 'fast', '--wait', '--timeout', '60', 'stop'
  ], 90_000);
  if (!result.ok) {
    throw new EngineError('The engine did not stop.', result.stderr.trim() || result.stdout.trim());
  }
  return 'stopped';
}
