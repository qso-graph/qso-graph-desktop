// SPDX-License-Identifier: GPL-3.0-only
import { readFile, writeFile } from 'node:fs/promises';
import { render, renderAttribution } from './icons.mjs';

const targets = [
  ['src/renderer/ui/icons.ts', render()],
  ['src/attribution.ts', renderAttribution()]
];

if (process.argv.includes('--check')) {
  for (const [target, wanted] of targets) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== wanted) {
      console.error(`${target} does not match the installed Font Awesome package. Run: node scripts/gen-icons.mjs`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${target} matches the installed package.`);
  }
} else {
  for (const [target, wanted] of targets) {
    await writeFile(target, wanted);
    console.log(`wrote ${target}`);
  }
}
