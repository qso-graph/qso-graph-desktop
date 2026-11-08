// SPDX-License-Identifier: GPL-3.0-or-later
// QG Trust's library in the credential core (#174). QGD-LTW-0001: it is a
// dependency of callsign.node, from QG Trust's repository at a release tag, and
// the lock file records the tag's commit; never crates.io or a branch.
// QGD-LTW-0006: the core installs the wiping allocator. CI's "QG Trust in the
// core" job runs QG Trust's own checks against the core's build; this holds the
// pieces that job reads.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync('packages/callsign-core/Cargo.toml', 'utf8');
const lock = readFileSync('packages/callsign-core/Cargo.lock', 'utf8');
const root = readFileSync('packages/callsign-core/src/lib.rs', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

const REPOSITORY = 'https://github.com/qso-graph/qso-graph-trust';
const TAG = /^v\d+\.\d+\.\d+(-beta\.\d+)?$/;

/** The source of each package of that name in a Cargo.lock. */
export function lockedSources(text, name) {
  return text.split('\n[[package]]\n').filter(entry => entry.includes(`\nname = "${name}"\n`) || entry.startsWith(`name = "${name}"\n`))
    .map(entry => entry.match(/^source = "(.*)"$/m)?.[1] ?? null);
}

describe('QG Trust in the credential core (QGD-LTW-0001)', () => {
  const declared = manifest.match(/^qso-graph-trust = \{ git = "([^"]+)", tag = "([^"]+)" \}$/m);

  it('takes the library from its repository at a release tag', () => {
    expect(declared?.[1]).toBe(REPOSITORY);
    expect(declared?.[2]).toMatch(TAG);
    expect(manifest).not.toMatch(/^qso-graph-trust\s*=\s*"/m);
    expect(manifest).not.toMatch(/qso-graph-trust[^\n]*\b(branch|rev|path)\s*=/);
  });

  it('records that tag and its commit in the lock file, once for each crate', () => {
    for (const name of ['qso-graph-trust', 'qso-graph-trust-awslc']) {
      const sources = lockedSources(lock, name);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatch(new RegExp(`^git\\+${REPOSITORY.replaceAll('.', '\\.')}\\?tag=${declared?.[2].replaceAll('.', '\\.')}#[0-9a-f]{40}$`));
    }
  });

  it('finds a planted branch or crates.io source', () => {
    const planted = lock.replace(/(name = "qso-graph-trust"\nversion = "[^"]+"\nsource = ")[^"]+/, `$1registry+https://github.com/rust-lang/crates.io-index`);
    expect(lockedSources(planted, 'qso-graph-trust')[0]).not.toMatch(/\?tag=/);
  });
});

describe('the core wipes what Rust frees (QGD-LTW-0006)', () => {
  it('installs QG Trust\'s wiping allocator at the top level of its root', () => {
    expect(root).toMatch(/^#\[global_allocator\]\nstatic [A-Z_]+: ::zeroizing_alloc::ZeroAlloc<::std::alloc::System> =\n\s+::zeroizing_alloc::ZeroAlloc\(::std::alloc::System\);$/m);
    expect(manifest).toMatch(/^zeroizing-alloc = \{ version = "=0\.1\.1", default-features = false \}$/m);
  });
});

describe('CI runs QG Trust\'s checks against the core', () => {
  const job = ci.split('\n  qg-trust:\n')[1]?.split('\n\n  # ')[0] ?? '';

  it('clones the pinned tag, checks its commit, and runs cargo xtask consumer', () => {
    expect(job).toContain('git clone --quiet --depth 1 --branch "$TAG" https://github.com/qso-graph/qso-graph-trust');
    expect(job).toContain('[ "$got" = "$COMMIT" ]');
    expect(job).toContain('cargo xtask consumer "$GITHUB_WORKSPACE/packages/callsign-core/Cargo.toml"');
  });

  it('is one of the jobs ci-all-green needs', () => {
    expect(ci).toMatch(/name: ci-all-green\n\s+needs: \[[^\]]*\bqg-trust\b[^\]]*\]/);
  });
});
