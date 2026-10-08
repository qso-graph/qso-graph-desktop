// SPDX-License-Identifier: GPL-3.0-only
// The engine's lifecycle: create the data directory, start, check, stop.
//
// QGD-ENG-0006. Every argument here is built by this module from the paths the
// frame chose. Nothing a user types reaches a command line, and the binaries
// are the pinned ones (QGD-ENG-0004) addressed by absolute path — the
// supervisor never resolves a program through PATH, because on a developer's
// Mac that finds a different PostgreSQL.
import { spawn } from 'node:child_process';
import { Client } from 'pg';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { configuration, connection, isEngineLog, type Endpoint, type EngineSettings } from './endpoint.js';

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
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 60_000;
const INCLUDE_LINE = `include '${SETTINGS_FILE}'`;

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

// What every PostgreSQL program is run with. No PATH, so nothing here can
// fall back to the machine's own PostgreSQL; no PGDATA, so an inherited one
// can never point the supervisor at somebody else's database; and messages in
// a language the log can be read in.
const PLAIN_ENV: NodeJS.ProcessEnv = {
  LC_ALL: 'C',
  LANG: 'C',
  HOME: process.env.HOME ?? '',
  TMPDIR: process.env.TMPDIR ?? '/tmp'
};

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
      env: PLAIN_ENV,
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

// Spawned, not handed to pg_ctl.
//
// pg_ctl builds the postmaster's command line as a string and runs it through
// a shell. That is the one place a shell survived in this code path, and it is
// what QGD-SEC-0002 bans everywhere we write ourselves — the "Application
// Support" failure came out of exactly that layer. Nothing is gained by it:
// the supervisor already owns the lifecycle, reads the lock file and decides
// when the engine is up.
//
// So: an argument array, no shell, and the postmaster's own pid rather than
// one parsed out of a file.
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

  const child = spawn(join(paths.binaries, 'postgres'), ['-D', paths.data], {
    env: PLAIN_ENV,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  // Everything the postmaster says before its own log collector takes over.
  // Kept in memory rather than in a file: on success the collector has it all,
  // and on failure this is the only place the reason exists.
  let early = '';
  const collect = (chunk: unknown) => { early = (early + String(chunk)).slice(-4000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited: number | null | undefined;
  let spawnError: Error | undefined;
  child.once('error', error => { spawnError = error as Error; });
  child.once('exit', code => { exited = code; });
  // Read through a function: these are set from callbacks, and checking them
  // inline lets the compiler narrow the first check into the second and decide
  // the second can never happen.
  const died = async (): Promise<EngineError | undefined> => {
    if (spawnError) return new EngineError('The engine could not be run.', spawnError.message);
    if (exited === undefined) return undefined;
    // The collector may already have taken over by the time it gave up — an
    // unreadable pg_hba.conf, for instance — in which case `early` holds only
    // the redirection notice and the reason is in the engine's own log.
    const written = await newestEngineLog(paths.logs);
    return new EngineError('The engine stopped as it started.',
      `${join(paths.binaries, 'postgres')} exited with ${exited}.\n${early.trim()}` +
      (written ? `\n${written}` : ''));
  };
  // The postmaster outlives this function; nothing here should keep the
  // process alive waiting on it.
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const gone = await died();
      if (gone) throw gone;
      const answer = await accepting(endpoint, paths.data);
      if (answer === 'elsewhere') {
        throw new EngineError('Something else is already answering on that socket.',
          `A PostgreSQL server is listening there, and it is not the one in ${paths.data}. ` +
          'Migrating it would be writing into somebody else\'s database.');
      }
      if (answer === 'ours') {
        // Checked again after the probe: a connection that was answered is not
        // the same as a server that is still there, and the probe takes time.
        const after = await died();
        if (after) throw after;
        return;
      }
      await delay(200);
    }
  } catch (error) {
    await stopIfRunning(paths);
    throw error;
  }

  // It is still running but not answering. Whatever this attempt started is
  // stopped: leaving it would refuse every later start, with nothing to say
  // which engine it belonged to.
  await stopIfRunning(paths);
  const log = await newestEngineLog(paths.logs);
  throw new EngineError('The engine did not start in time.',
    `${early.trim()}${log ? `\n${log}` : ''}`);
}

// Readiness is a connection, because that is what "started" has to mean for
// anything that is about to use it. The bundled build has no pg_isready
// (QGD-ENG-0005), and a socket file appearing is not the same as a postmaster
// that will answer.
//
// And it has to be OUR postmaster. A socket directory can already belong to
// another cluster — a stale server, a second installation whose short
// directory collided — and a probe that only asked "did something answer"
// would report started while ours failed to bind, after which the migrations
// would be applied to somebody else's database. So the server is asked which
// data directory it is serving.
async function accepting(endpoint: Endpoint, data: string): Promise<'ours' | 'elsewhere' | 'not-yet'> {
  const client = new Client({ ...connection(endpoint, 'postgres', superuser()), connectionTimeoutMillis: 2000 });
  // A refused connection is the expected answer while it is still coming up.
  client.on('error', () => {});
  try {
    await client.connect();
    const answer = await client.query<{ data_directory: string }>('SHOW data_directory');
    const serving = answer.rows[0]?.data_directory ?? '';
    return await sameDirectory(serving, data) ? 'ours' : 'elsewhere';
  } catch {
    return 'not-yet';
  } finally {
    await client.end().catch(() => {});
  }
}

// Compared after resolving, because macOS hands out temporary directories
// under /var/folders, which is a symlink to /private/var/folders — the server
// reports the resolved path and we hold the one we were given.
async function sameDirectory(a: string, b: string): Promise<boolean> {
  if (a === '' || b === '') return false;
  try {
    return await realpath(a) === await realpath(b);
  } catch {
    return false;
  }
}

// Not unref'd: these waits are the only thing holding the event loop open
// while the engine comes up or shuts down, and an unref'd timer lets the
// process exit in the middle of either.
function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

async function stopIfRunning(paths: EnginePaths): Promise<void> {
  if (await runningPid(paths) !== undefined) await stop(paths).catch(() => {});
}

// SIGINT is PostgreSQL's fast shutdown: roll back what is open and exit,
// rather than waiting for clients to disconnect on their own. The signal goes
// to whatever postmaster.pid names, so a supervisor that was restarted can
// still stop the engine it did not start.
export async function stop(paths: EnginePaths): Promise<'stopped' | 'was-not-running'> {
  const pid = await runningPid(paths);
  if (pid === undefined) return 'was-not-running';

  try {
    process.kill(pid, 'SIGINT');
  } catch {
    // Gone between the check and the signal, which is the result we wanted.
    return 'stopped';
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await runningPid(paths) === undefined) return 'stopped';
    await delay(100);
  }

  throw new EngineError('The engine did not stop.',
    `Process ${pid} is still running ${STOP_TIMEOUT_MS / 1000} seconds after a fast shutdown was asked for.`);
}


// postgresql.conf is PostgreSQL's; the include line is ours, added once.
async function ensureInclude(data: string): Promise<void> {
  const path = join(data, 'postgresql.conf');
  const current = await readFile(path, 'utf8');
  if (current.includes(INCLUDE_LINE)) return;
  await writeFile(path, `${current}\n# The engine supervisor's own settings.\n${INCLUDE_LINE}\n`);
}

// The tail of the engine's own log. Once the collector has started this is
// where the reason for anything lives, and a failed start that printed only
// what the supervisor saw said nothing useful.
async function newestEngineLog(logs: string): Promise<string> {
  let names: string[];
  try { names = await readdir(logs); } catch { return ''; }
  const engine = names.filter(isEngineLog).sort();
  const newest = engine[engine.length - 1];
  if (newest === undefined) return '';
  const contents = await readFile(join(logs, newest), 'utf8').catch(() => '');
  return contents.trim().split('\n').slice(-10).join('\n');
}
