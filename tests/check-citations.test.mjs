// SPDX-License-Identifier: GPL-3.0-only
// Every QGD-* ID a Markdown file cites exists in the spec (#95). The check is
// proved to catch a bad citation, then run on the repository.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownFiles, unknownCitations } from '../scripts/check-citations.mjs';

const spec = '| `QGD-AST-0001` | the sun |\nRetired and never reused: `QGD-ENG-0004`.\n';

describe('citations of requirement IDs (#95)', () => {
  it('finds an ID the spec does not have, with its file and line', () => {
    const problems = unknownCitations(spec, [['guide/astro.md', 'See QGD-AST-0001.\nAnd QGD-AST-0099, which is made up.']]);
    expect(problems).toEqual(['guide/astro.md:2: QGD-AST-0099']);
  });

  it('accepts a defined ID, and a retired one, which the spec still names', () => {
    expect(unknownCitations(spec, [['AGENTS.md', 'QGD-AST-0001 and the old QGD-ENG-0004']])).toEqual([]);
  });

  it('finds no unknown citation in this repository', () => {
    const files = markdownFiles('.').filter(file => file !== 'spec/QGD-SPEC-001.md').map(file => [file, readFileSync(file, 'utf8')]);
    expect(files.length).toBeGreaterThan(20);
    expect(unknownCitations(readFileSync('spec/QGD-SPEC-001.md', 'utf8'), files)).toEqual([]);
  });
});
