// SPDX-License-Identifier: GPL-3.0-only
// Update the checkout the verification account runs `make verify` in.
//
// KI7MT, 2026-10-09: `make verify` runs from the non-admin `qgdesktop`
// account, so the suites never touch his login keychain (QGD-CRD-0013). That
// account cannot reach the working repo — `/Users/gbeam` is `drwxr-x---`, so
// it cannot even traverse into it — and it deliberately holds no GitHub
// credential, so it cannot fetch from the remote either.
//
// Both of those are features, not obstacles to work around. So the sync is
// done from this side: an operator who can read the working repo pushes the
// commit across into a world-writable checkout, and the verification account
// only ever runs what is already there. Nothing in that account needs a
// credential, a network path, or a route into anybody's home directory.
//
// Run as the developing account:
//     node scripts/sync-verify-checkout.mjs [ref]
import { spawnSync } from 'node:child_process';
import { access, constants, writeFile } from 'node:fs/promises';

export const CHECKOUT = '/Users/Shared/qg-desktop-verify';
export const SHARED_RUST = '/Users/Shared/rust';

const ref = process.argv[2] ?? 'develop';

function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')}\n${result.stderr || result.stdout || ''}`.trim());
  }
  return (result.stdout ?? '').trim();
}

try {
  await access(CHECKOUT, constants.W_OK);
} catch {
  throw new Error(
    `${CHECKOUT} is not there or not writable.\n` +
    `Create it once with:\n  git clone ${process.cwd()} ${CHECKOUT}\n  chmod -R a+rwX ${CHECKOUT}`);
}

const head = run(['git', 'rev-parse', ref]);
// Fetched from this working tree by path, which only this side can read.
//
// Into FETCH_HEAD rather than straight into the branch: git refuses a refspec
// that targets the branch the destination has checked out, and reasonably so.
run(['git', '-C', CHECKOUT, 'fetch', '--quiet', process.cwd(), ref]);
run(['git', '-C', CHECKOUT, 'checkout', '--quiet', '--force', '-B', ref, 'FETCH_HEAD']);
run(['git', '-C', CHECKOUT, 'reset', '--quiet', '--hard', head]);
// Nothing of a previous run's output is left to be mistaken for this one's.
run(['git', '-C', CHECKOUT, 'clean', '-qfd', '-e', 'node_modules', '-e', 'vendor', '-e', 'verify-env.sh']);

// The environment that account needs, written beside the checkout rather than
// left as something to remember. CARGO_HOME is why scripts/cargo-path.mjs
// resolves cargo instead of assuming ~/.cargo (which does not exist there).
await writeFile(`${CHECKOUT}/verify-env.sh`, `# SPDX-License-Identifier: GPL-3.0-only
# Written by scripts/sync-verify-checkout.mjs. Source this before make verify.
#
# The Rust toolchain is shared from ${SHARED_RUST} rather than installed per
# account: same version, no second download, and nothing in this account needs
# to reach another user's home directory.
export RUSTUP_HOME=${SHARED_RUST}/rustup
export CARGO_HOME=${SHARED_RUST}/cargo
export PATH="${SHARED_RUST}/cargo/bin:/opt/homebrew/bin:$PATH"
`);

// The verification account writes dist/, out/, report/ and target/ here.
run(['chmod', '-R', 'a+rwX', CHECKOUT]);

const at = run(['git', '-C', CHECKOUT, 'log', '--oneline', '-1']);
console.log(`Verification checkout synced: ${CHECKOUT}`);
console.log(`  ${ref} at ${at}`);
console.log(`  toolchain: ${SHARED_RUST} (shared, read-write)`);
console.log('');
console.log('Then, logged in as qgdesktop:');
console.log(`  cd ${CHECKOUT} && . ./verify-env.sh && npm ci && node scripts/fetch-postgres.mjs && make verify`);
