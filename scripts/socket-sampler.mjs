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
import { spawnSync } from 'node:child_process';

const pid = Number(process.argv[2]);
const until = Date.now() + Number(process.argv[3] ?? 2000);
if (!Number.isInteger(pid)) throw new Error('usage: socket-sampler.mjs <pid> <ms>');

const seen = new Set();
let readings = 0;
let failures = 0;
while (Date.now() < until) {
  // -a, because lsof ORs its filters: without it this reads every socket on
  // the machine rather than this process's.
  const run = spawnSync('lsof', ['-a', '-p', String(pid), '-i', '-n', '-P', '-F', 'n'], { encoding: 'utf8' });
  if (run.error || (run.status !== 0 && (run.stderr || '').trim() !== '')) { failures += 1; continue; }
  readings += 1;
  for (const line of (run.stdout || '').split('\n')) {
    if (line.startsWith('n')) seen.add(line.slice(1));
  }
}
process.stdout.write(JSON.stringify({ readings, failures, sockets: [...seen] }));
