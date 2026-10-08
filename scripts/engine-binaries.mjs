// SPDX-License-Identifier: GPL-3.0-only
// P4-binaries and P4-no-client-tools: the engine runs from the pinned build and
// nothing else (QGD-ENG-0004, QGD-ENG-0005).
//
// Checked here as its own suite rather than inside the engine's tests, because
// every other engine suite depends on it being true and a clear "run make
// setup" is worth more than six suites failing for the same reason.
import { readFile } from 'node:fs/promises';
import { binariesDirectory, verifyBinaries } from './postgres-build.mjs';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const result = await verifyBinaries(build);

if (!result.ok) {
  console.error('The pinned PostgreSQL build is not usable.');
  for (const problem of result.problems) console.error(`  ${problem}`);
  console.error('  Fetch and verify it with: make setup');
  process.exitCode = 1;
} else {
  console.log(`Engine binaries: PostgreSQL ${result.version} from ${binariesDirectory(build)}, ` +
    `${build.contains.join(', ')} present and ${build.absent.programs.join(', ')} absent as recorded: PASS`);
}
