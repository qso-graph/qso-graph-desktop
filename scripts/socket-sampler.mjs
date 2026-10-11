// SPDX-License-Identifier: GPL-3.0-only
// Reads one process's internet sockets over and over, and prints what it saw.
//
// A separate process because the thing being watched blocks: the credential
// core's export is a synchronous call into Rust, so a timer in the process
// making that call cannot fire until it has returned. A sampler inside it can
// only ever read before and after, which would miss a socket opened and closed
// within the call — exactly the socket worth catching.
//
// Usage: node scripts/socket-sampler.mjs <pid> <milliseconds>
import { socketsOf } from './platform-process.mjs';

const pid = Number(process.argv[2]);
const until = Date.now() + Number(process.argv[3] ?? 2000);
if (!Number.isInteger(pid)) throw new Error('usage: socket-sampler.mjs <pid> <ms>');

const seen = new Set();
let readings = 0;
let failures = 0;
while (Date.now() < until) {
  const reading = socketsOf(pid);
  if (!reading.ok) { failures += 1; continue; }
  readings += 1;
  for (const socket of reading.sockets) seen.add(socket);
}
process.stdout.write(JSON.stringify({ readings, failures, sockets: [...seen] }));
