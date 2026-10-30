// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0022 (#136): the Rust components' own code uses no `unsafe`. Each
// crate denies it at its root, so the compiler refuses an `unsafe` block, and
// no source file allows it back. The crates are found from the tree
// (QGD-SEC-0021), so a new one is held to this without being named here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DENY = /^#!\[deny\(unsafe_code\)\]$/m;
const ALLOW = /#!?\[\s*(allow|warn|expect)\s*\([^)]*\bunsafe_code\b/;

export function crates(root = 'packages') {
  return readdirSync(root).map(name => join(root, name)).filter(dir => existsSync(join(dir, 'Cargo.toml')));
}

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.rs') ? [join(dir, entry.name)] : []);
}

export function allowsUnsafe(text) {
  return text.split('\n').filter(line => !line.trim().startsWith('//')).some(line => ALLOW.test(line));
}

describe('our Rust code uses no unsafe (QGD-SEC-0022)', () => {
  const found = crates();

  it('finds both Rust components', () => {
    expect(found).toEqual(expect.arrayContaining([join('packages', 'callsign-core'), join('packages', 'integrations-core')]));
  });

  for (const crate of found) {
    it(`${crate} denies unsafe_code at its root`, () => {
      expect(readFileSync(join(crate, 'src', 'lib.rs'), 'utf8')).toMatch(DENY);
    });

    it(`${crate} allows it back nowhere`, () => {
      const allowing = sources(join(crate, 'src')).filter(file => allowsUnsafe(readFileSync(file, 'utf8')));
      expect(allowing).toEqual([]);
    });
  }

  it('would catch unsafe allowed back', () => {
    expect(allowsUnsafe('#[allow(unsafe_code)]\nfn f() {}')).toBe(true);
    expect(allowsUnsafe('#![allow(dead_code, unsafe_code)]')).toBe(true);
    expect(allowsUnsafe('// #[allow(unsafe_code)] is not allowed here')).toBe(false);
    expect('#![forbid(unsafe_code)]').not.toMatch(DENY);
  });
});
