// SPDX-License-Identifier: GPL-3.0-only
// The engine's lifecycle: create the data directory, start, check, stop.
//
// QGD-ENG-0006. Every argument here is built by this module from the paths the
// frame chose. Nothing a user types reaches a command line, and the binaries
// are the pinned ones (QGD-ENG-0004) addressed by absolute path — the
// supervisor never resolves a program through PATH, because on a developer's
// Mac that finds a different PostgreSQL.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { configuration, isEngineLog, type Endpoint, type EngineSettings } from './endpoint.js';

export interface EnginePaths {
  // The PostgreSQL build's bin directory (QGD-ENG-0004).
  binaries: string;
  // The data directory: created on first run, and the thing a backup copies.
  data: string;
  // Where the Unix socket is put, on the platforms that use one.
  sockets: string;
  // The application's managed log directory (QGD-LOG-0011).
  logs: string;
}

// The file the supervisor owns. postgresql.conf includes it, so our settings
// are in one place and PostgreSQL's defaults are left alone.
const SETTINGS_FILE = 'qg-engine.conf';
const INCLUDE_LINE = `include '${SETTINGS_FILE}'`;

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
      '--username', superuser(),
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
  // The order matters and the scoping matters more. PostgreSQL uses the FIRST
  // line that matches the connection and does not try the next one when
  // authentication fails — so `local all all peer` as the first rule makes
  // every later rule unreachable, and an application role could never log in
  // however correct its password was.
  await writeFile(join(data, 'pg_hba.conf'),
    '# Written by the engine supervisor. QGD-ENG-0009 and QGD-ENG-0010.\n' +
    '# The bootstrap superuser, and only it: the operating system says who is\n' +
    '# connecting, so there is no superuser password to store or to steal.\n' +
    `local   all   ${superuser()}   peer\n` +
    '# Everything else is an application role, which is not an operating-system\n' +
    '# user and so proves itself with a password.\n' +
    'local   all   all   scram-sha-256\n' +
    '# There is no TCP listener. If one is ever configured, it is refused here too.\n' +
    'host    all   all   all   reject\n',
    { mode: 0o600 });
}

// The role initdb creates and the one the supervisor connects as. Taken from
// the operating system because peer authentication compares against exactly
// that, and a mismatch would lock the supervisor out of its own database.
export function superuser(): string {
  return userInfo().username;
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
  await mkdir(paths.logs, { recursive: true });

  const settings: EngineSettings = { endpoint, logDirectory: paths.logs };
  await writeFile(join(paths.data, SETTINGS_FILE), configuration(settings), { mode: 0o600 });
  await ensureInclude(paths.data);

  const result = await run(paths, 'pg_ctl', [
    '--pgdata', paths.data,
    // Everything the postmaster needs is in the configuration file. pg_ctl's
    // --options is a string it hands to a shell, and a socket directory under
    // "Application Support" — which is where macOS puts it — would arrive as
    // two arguments and refuse to start.
    '--log', join(paths.logs, 'engine-startup.log'),
    // Waits for the postmaster to be accepting connections, so a start that
    // returns has actually started.
    '--wait',
    '--timeout', '60',
    'start'
  ], 90_000);

  if (!result.ok) {
    // pg_ctl giving up waiting does not mean nothing started: the postmaster
    // may still be in recovery and may come up a moment later. Leaving it
    // there would refuse every later start, with nothing to tell the caller
    // which engine is theirs. Whatever this attempt launched is stopped.
    const stray = await runningPid(paths);
    if (stray !== undefined) await stop(paths).catch(() => {});
    // The startup file only ever holds "redirecting log output to logging
    // collector"; the reason is in the collector's own file, which is the one
    // worth printing. Without this a failed start said nothing useful.
    const log = await newestEngineLog(paths.logs);
    throw new EngineError('The engine did not start.',
      (result.stderr.trim() || result.stdout.trim() || '') +
      (stray !== undefined ? '\nIt had started late and was stopped.' : '') +
      (log ? `\n${log}` : ''));
  }
}

async function newestEngineLog(logs: string): Promise<string> {
  let names: string[];
  try { names = await readdir(logs); } catch { return ''; }
  const engine = names.filter(isEngineLog).sort();
  const newest = engine[engine.length - 1];
  if (newest === undefined) return '';
  const contents = await readFile(join(logs, newest), 'utf8').catch(() => '');
  return contents.trim().split('\n').slice(-10).join('\n');
}

// postgresql.conf is PostgreSQL's; the include line is ours, added once.
async function ensureInclude(data: string): Promise<void> {
  const path = join(data, 'postgresql.conf');
  const current = await readFile(path, 'utf8');
  if (current.includes(INCLUDE_LINE)) return;
  await writeFile(path, `${current}\n# The engine supervisor's own settings.\n${INCLUDE_LINE}\n`);
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
