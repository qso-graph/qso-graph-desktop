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
import { access, constants, readFile, writeFile } from 'node:fs/promises';

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
// No clean at all.
//
// `git reset --hard` above already restores every tracked file, which is the
// content that matters. Build output is not ours to remove: dist/, out/,
// report/ and target/ belong to the verification account, which created them,
// and its next build overwrites them. Two attempts to tidy them failed for the
// same reason a beat apart — a blanket `chmod -R` and then a scoped
// `git clean -qfdx -- dist` — because removing or re-moding another user's
// file needs root, and neither needed doing.
//
// The earlier unscoped `git clean -qfd` was worse than a nuisance: it removed
// every untracked file that was not ignored, which is how it destroyed a
// scratchpad KI7MT was keeping in this directory.

const MARKER = '# Written by scripts/sync-verify-checkout.mjs';
const envFile = `${CHECKOUT}/verify-env.sh`;
try {
  const existing = await readFile(envFile, 'utf8');
  if (!existing.includes(MARKER)) {
    throw new Error(`${envFile} exists and this script did not write it. Refusing to overwrite it.`);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(envFile, `# SPDX-License-Identifier: GPL-3.0-only
${MARKER}. Source this before make verify.
#
# The Rust toolchain is shared from ${SHARED_RUST} rather than installed per
# account: same version, no second download, and nothing in this account needs
# to reach another user's home directory.
export RUSTUP_HOME=${SHARED_RUST}/rustup
export CARGO_HOME=${SHARED_RUST}/cargo
export PATH="${SHARED_RUST}/cargo/bin:/opt/homebrew/bin:$PATH"
`);

// The commands are PRINTED, never written to a file.
//
// An earlier version wrote them to startup.txt. KI7MT had created that file
// himself as a scratchpad, and on 2026-10-09 this script overwrote it — three
// times — destroying the DKIM and site-verification records he had pasted
// there while setting up DNS for qso-graph.io. It did so because the write had
// no check of any kind: not whether the file existed, not who made it, not
// whether this script had written it before. And the directory was world
// writable by my own hand, so the non-admin account could build in it.
//
// Generating a crib sheet was reasonable. Claiming a filename in a shared
// directory and overwriting it unconditionally was not. A script that writes a
// file it did not create will eventually destroy one that mattered.
//
// So this writes exactly one file — verify-env.sh, which it created and which
// carries its own marker — and refuses even that if the marker is absent.
const commands = [
  `cd ${CHECKOUT}`,
  '. ./verify-env.sh',
  'make setup          # first time in this account only',
  'make verify'
];

// Made writable so the verification account can build here — but only the
// files this account owns.
//
// After the first run in that account, node_modules, vendor, dist, out, report
// and target belong to IT: it ran `make setup` and `make verify`. chmod on
// another user's file is refused unless you are root, so a blanket
// `chmod -R` fails with thousands of "Operation not permitted" lines the
// moment the procedure actually starts being used — which is exactly what
// happened on the first sync after the first run. Those directories do not
// need our permission anyway; they are already that account's.
run(['bash', '-c',
  `find ${JSON.stringify(CHECKOUT)} ` +
  '\\( -name node_modules -o -name vendor -o -name target -o -name dist ' +
  '   -o -name out -o -name report -o -name .git \\) -prune -o ' +
  `-user "$(id -un)" -print0 | xargs -0 chmod a+rwX`]);

const at = run(['git', '-C', CHECKOUT, 'log', '--oneline', '-1']);
console.log(`Verification checkout synced: ${CHECKOUT}`);
console.log(`  ${ref} at ${at}`);
console.log(`  toolchain: ${SHARED_RUST} (shared, read-write)`);
console.log('');
console.log('Then, logged in as qgdesktop:');
// Printed from the same string that was just written, so the message and the
// crib sheet cannot say different things. They did: this line listed two of
// the four setup steps while startup.txt was being hand-maintained.
for (const command of commands) console.log(`  ${command}`);
