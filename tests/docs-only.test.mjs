// SPDX-License-Identifier: GPL-3.0-only
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

  it('is not the spec or the CHANGELOG, which the build reads', () => {
    expect(documentationOnly(['spec/QGD-SPEC-001.md'])).toBe(false);
    expect(documentationOnly(['CHANGELOG.md'])).toBe(false);
  });
});
