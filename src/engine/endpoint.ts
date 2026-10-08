// SPDX-License-Identifier: GPL-3.0-only
// Where the engine listens, and what the supervisor tells PostgreSQL to do
// about it.
//
// QGD-ENG-0009. On macOS and Linux the engine listens on a Unix socket inside
// the application's own directory and opens no TCP port at all — there is no
// listener for anything else on the machine to reach, which is a stronger
// property than binding loopback and hoping. Windows has no equivalent, so
// there it listens on loopback on a port chosen free at start.
//
// The decisions here are pure so they can be tested without starting a
// database; asking the operating system for a free port is the one thing that
// cannot be, and it is separated out below.
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

// A Unix socket path is not a path: it has to fit in a fixed-size field in
// the address structure, 104 bytes on macOS and 108 on Linux, including the
// terminator. PostgreSQL puts `/.s.PGSQL.<port>` inside the directory it is
// given, so the directory has to be shorter still.
//
// This is not a corner case. The obvious place for the socket — beside the
// data, under "~/Library/Application Support/QSO Graph Desktop" — comes to
// about 78 bytes on this Mac and would break on a machine with a longer home
// directory. Measured and chosen rather than assumed.
export const SOCKET_PATH_LIMIT = process.platform === 'linux' ? 107 : 103;
export const DEFAULT_PORT = 5432;

export function socketPathLength(directory: string, port = DEFAULT_PORT): number {
  return Buffer.byteLength(`${directory}/.s.PGSQL.${port}`, 'utf8');
}

export function fitsSocketPath(directory: string, port = DEFAULT_PORT, limit = SOCKET_PATH_LIMIT): boolean {
  return socketPathLength(directory, port) <= limit;
}

// A short directory of its own, named from the data directory so it is the
// same one at every start and two installations never share it.
export function shortSocketDirectory(dataDirectory: string, home = homedir()): string {
  const id = createHash('sha256').update(dataDirectory).digest('hex').slice(0, 8);
  return join(home, `.qg-desktop-${id}`);
}

// The first candidate that fits. The preferred one is beside the data, where
// it belongs; the short one in the home directory is the fallback when the
// path runs out of room.
export function chooseSocketDirectory(
  candidates: readonly string[],
  port = DEFAULT_PORT,
  limit = SOCKET_PATH_LIMIT
): string {
  const chosen = candidates.find(candidate => fitsSocketPath(candidate, port, limit));
  if (chosen === undefined) {
    throw new Error(
      `No socket directory fits in ${limit} bytes: ` +
      candidates.map(c => `${c} (${socketPathLength(c, port)})`).join(', '));
  }
  return chosen;
}

export function socketCandidates(dataDirectory: string, beside: string, home = homedir()): string[] {
  return [beside, shortSocketDirectory(dataDirectory, home)];
}

export type Endpoint =
  | { kind: 'socket'; directory: string }
  | { kind: 'port'; port: number };

export function usesSocket(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

// The settings the supervisor writes into the engine's own configuration file.
//
// A configuration file rather than pg_ctl's --options, which is a string
// pg_ctl hands to a shell: a socket directory under "Application Support" —
// which is exactly where macOS puts it — arrives at the postmaster as two
// arguments and it refuses to start. There is no shell here, and a value with
// a space, a quote or a dollar sign in it is just a value.
export interface EngineSettings {
  endpoint: Endpoint;
  // Where PostgreSQL writes its own log. The application's managed log
  // directory, so QGD-LOG-0011's caps, retention and redaction reach it.
  logDirectory: string;
  maxLogBytes?: number;
}

// postgresql.conf quotes with single quotes and escapes one by doubling it.
export function configValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function configuration(settings: EngineSettings): string {
  const { endpoint } = settings;
  const lines = [
    '# Written by the engine supervisor. Do not edit: it is rewritten at every',
    '# start, from QGD-ENG-0009 and QGD-LOG-0011.',
  ];

  if (endpoint.kind === 'socket') {
    // No TCP listener of any kind. An empty listen_addresses is what makes
    // "opens no TCP port at all" true rather than aspirational.
    lines.push("listen_addresses = ''");
    lines.push(`unix_socket_directories = ${configValue(endpoint.directory)}`);
    lines.push('unix_socket_permissions = 0700');
  } else {
    lines.push("listen_addresses = '127.0.0.1'");
    lines.push(`port = ${endpoint.port}`);
  }

  // QGD-LOG-0011: the engine's log lives in the same directory as every other
  // log, under the same caps. PostgreSQL rotates its own, because the file is
  // open in a process we do not control and renaming it underneath would
  // leave it writing into the archive.
  lines.push('logging_collector = on');
  lines.push(`log_directory = ${configValue(settings.logDirectory)}`);
  lines.push(`log_filename = ${configValue(ENGINE_LOG_PREFIX + '-%Y-%m-%d_%H%M%S.log')}`);
  lines.push('log_rotation_age = 1440');
  lines.push(`log_rotation_size = ${Math.floor((settings.maxLogBytes ?? 5 * 1024 * 1024) / 1024)}`);
  lines.push('log_file_mode = 0600');
  return lines.join('\n') + '\n';
}

// Every engine log file starts with this, which is how the log directory's
// caps tell them apart from the application's own.
export const ENGINE_LOG_PREFIX = 'engine';

export function isEngineLog(name: string): boolean {
  return name.startsWith(`${ENGINE_LOG_PREFIX}-`) && name.endsWith('.log');
}

// What a client connects with. Returned as parts rather than a URL so a
// password never has to be spliced into a string that might be logged.
export function connection(endpoint: Endpoint, database: string, user: string) {
  return endpoint.kind === 'socket'
    ? { host: endpoint.directory, database, user }
    : { host: '127.0.0.1', port: endpoint.port, database, user };
}

// QGD-ENG-0009's Windows path, built and tested everywhere because that is
// where it has to work and nobody runs it here.
//
// The port is asked of the operating system rather than picked and tried:
// binding port 0 has it hand back one that was free at that instant. That is
// still a race — anything may take it before the postmaster binds — so the
// caller must treat a failed start as "try again", not as "the port is wrong".
export async function freePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('the operating system gave no port');
    return address.port;
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
