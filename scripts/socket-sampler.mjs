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
// The window starts at the first reading, not at spawn (see below).
const span = Number(process.argv[3] ?? 2000);
let until = Date.now() + span;
if (!Number.isInteger(pid)) throw new Error('usage: socket-sampler.mjs <pid> <ms>');

// "watching" goes out once the first reading is in, so the caller opens
// nothing until this is looking. The window used to start when the process
// was spawned, so on a slow runner the first reading could come after the
// caller's deliberate socket had opened and closed; the control failed once
// that way on CI (Linux x64, 2026-10-22). The thing being measured could have
// slipped past the same way, unseen, which is the worse half.
//
// The loop yields between readings: a write to a pipe is asynchronous on macOS
// and Windows, so a loop that never yields would hold "watching" back until it
// ended.
const seen = new Set();
let readings = 0;
let failures = 0;
let told = false;
while (Date.now() < until) {
  const reading = socketsOf(pid);
  if (!reading.ok) { failures += 1; continue; }
  readings += 1;
  for (const socket of reading.sockets) seen.add(socket);
  if (!told) { process.stdout.write('watching\n'); told = true; until = Date.now() + span; }
  await new Promise(done => setImmediate(done));
}
process.stdout.write(JSON.stringify({ readings, failures, sockets: [...seen] }));
