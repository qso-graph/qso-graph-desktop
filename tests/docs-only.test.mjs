// SPDX-License-Identifier: GPL-3.0-or-later
// What counts as a documentation-only change (#95), with the planted defects
// that must make it build: code among the files, code renamed into docs/
// (#92), and no files read at all.
import { describe, expect, it } from 'vitest';
import { documentationOnly } from '../scripts/docs-only.mjs';

describe('a documentation-only change (#95)', () => {
  it('is one where every file is documentation', () => {
    expect(documentationOnly(['README.md', 'docs/RELEASES.md', 'guide/start.md', 'AGENTS.md', '.github/pull_request_template.md'])).toBe(true);
  });

  it('is not one with code in it', () => {
    expect(documentationOnly(['docs/RELEASES.md', 'packages/main/main.ts'])).toBe(false);
  });

  it('is not one that moves code into docs/: the old name counts too', () => {
    expect(documentationOnly(['docs/main.ts', 'packages/main/main.ts'])).toBe(false);
  });

  it('is not one whose files could not be read', () => {
    expect(documentationOnly([])).toBe(false);
    expect(documentationOnly(['', '  '])).toBe(false);
  });

  it('is the spec and its RVM, which the citations job checks', () => {
    expect(documentationOnly(['spec/QGD-SPEC-001.md'])).toBe(true);
    expect(documentationOnly(['spec/QGD-SPEC-001.md', 'rvm/QGD-RVM-001.md'])).toBe(true);
  });

  it('is not the CHANGELOG, which ships as What\'s New', () => {
    expect(documentationOnly(['CHANGELOG.md'])).toBe(false);
    expect(documentationOnly(['spec/QGD-SPEC-001.md', 'CHANGELOG.md'])).toBe(false);
  });

  it('is not a spec-looking path anywhere else', () => {
    expect(documentationOnly(['packages/spec/index.ts'])).toBe(false);
    expect(documentationOnly(['spec'])).toBe(false);
  });
});
