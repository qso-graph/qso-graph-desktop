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
import { createServer } from 'node:net';

export type Endpoint =
  | { kind: 'socket'; directory: string }
  | { kind: 'port'; port: number };

export function usesSocket(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

// The options passed to the postmaster. QGD-ENG-0006: every one of these comes
// from the supervisor, and none of it from anything a user typed.
export function postgresOptions(endpoint: Endpoint): string[] {
  if (endpoint.kind === 'socket') {
    return [
      // No TCP listener of any kind. An empty listen_addresses is what makes
      // "opens no TCP port at all" true rather than aspirational.
      '-c', 'listen_addresses=',
      '-c', `unix_socket_directories=${endpoint.directory}`,
      // The socket directory is the application's own and nobody else's.
      '-c', 'unix_socket_permissions=0700'
    ];
  }
  return [
    '-c', 'listen_addresses=127.0.0.1',
    '-c', `port=${endpoint.port}`
  ];
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
