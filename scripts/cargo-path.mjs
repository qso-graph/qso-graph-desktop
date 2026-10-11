// SPDX-License-Identifier: GPL-3.0-only
// Where cargo is, resolved rather than assumed.
//
// build-native.mjs and rust-unit.mjs both hardcoded `~/.cargo/bin/cargo`,
// which is only true for the account that installed rustup. KI7MT's direction
// on 2026-10-09 is that `make verify` runs from the non-admin `qgdesktop`
// account, so the suites never touch his login keychain (QGD-CRD-0013) — and
// in that account the hardcoded path does not exist.
//
// Same class of defect as the test script that baked in one machine's repo
// path: a path that happens to be right where it was written. Resolution
// order, most explicit first:
//
//   1. CARGO_HOME, which is how a shared or relocated toolchain is named
//   2. PATH, which is how a normal install is found
//   3. ~/.cargo/bin, the rustup default
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

async function runnable(path) {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

export async function cargoPath() {
  return resolve('cargo');
}

// rustc lives beside cargo in every rustup install, and crypto-evidence.mjs
// records its version in the evidence file. It had the same hardcoded
// ~/.cargo/bin path, and was only not failing yet because the build failed
// first and blocked that suite.
export async function rustcPath() {
  return resolve('rustc');
}

async function resolve(name) {
  // rustup installs cargo.exe and rustc.exe on Windows.
  const tool = process.platform === 'win32' ? `${name}.exe` : name;
  const tried = [];
  const candidates = [];

  if (process.env.CARGO_HOME) candidates.push(join(process.env.CARGO_HOME, 'bin', tool));
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry) candidates.push(join(entry, tool));
  }
  candidates.push(join(homedir(), '.cargo', 'bin', tool));

  for (const candidate of candidates) {
    tried.push(candidate);
    if (await runnable(candidate)) return candidate;
  }
  // Every place looked in, named. A "cargo not found" that does not say where
  // it looked is the start of an hour's guessing.
  throw new Error(
    `${tool} was not found. Looked in CARGO_HOME, on PATH, and in ~/.cargo/bin:\n  ` +
    [...new Set(tried)].join('\n  '));
}
