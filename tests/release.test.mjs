// SPDX-License-Identifier: GPL-3.0-only
// The release steps that are text (scripts/release.mjs, docs/RELEASES.md):
// the notes a release publishes are its CHANGELOG section, and main builds a
// release only when that section is there.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, isRelease, next, notes, prepare } from '../scripts/release.mjs';

const changelog = [
  '# Changelog', '',
  '## [Unreleased]', '',
  '### Added', '', '- Parks Near Me.', '',
  '## [0.0.9] - 2026-09-01', '', '- Older.', ''
].join('\n');

describe('release text', () => {
  it('turns [Unreleased] into the version, under a new empty [Unreleased]', () => {
    const done = prepare(changelog, '0.1.0', '2026-10-24');
    expect(done).toContain('## [Unreleased]\n\n## [0.1.0] - 2026-10-24\n\n### Added');
    expect(notes(done, '0.1.0')).toBe('### Added\n\n- Parks Near Me.');
    expect(notes(done, '0.0.9')).toBe('- Older.');
  });

  it('refuses to prepare twice, or a version that is not a release', () => {
    const done = prepare(changelog, '0.1.0', '2026-10-24');
    expect(() => prepare(done, '0.1.0', '2026-10-24')).toThrow(/already has/);
    expect(() => prepare(changelog, '0.1.0-202610230124-34d3a62a1b0', '2026-10-24')).toThrow(/not a release/);
  });

  it('lets main release only a plain version with a section that says something', () => {
    expect(check(changelog, '0.1.0')).toMatch(/no "## \[0.1.0\]/);
    expect(check(prepare(changelog, '0.1.0', '2026-10-24'), '0.1.0')).toBeUndefined();
    expect(check(changelog, '0.1.0-202610230124-34d3a62a1b0')).toMatch(/not a release/);
    expect(check('## [0.1.0] - 2026-10-24\n\n## [0.0.9] - 2026-09-01\n', '0.1.0')).toMatch(/empty/);
  });

  it('a preview version is not a release one', () => {
    expect(isRelease('0.1.0')).toBe(true);
    expect(isRelease('v0.1.0')).toBe(false);
    expect(isRelease('01.0.0')).toBe(false);
  });

  it('moves to the next version', () => {
    expect(next('0.1.0', 'minor')).toBe('0.2.0');
    expect(next('0.1.0', 'patch')).toBe('0.1.1');
    expect(next('0.9.3', 'major')).toBe('1.0.0');
    expect(() => next('0.1.0', 'tiny')).toThrow(/major, minor or patch/);
  });

  it('this repository has a version and a changelog the steps can read', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    expect(isRelease(version), version).toBe(true);
    expect(readFileSync('CHANGELOG.md', 'utf8')).toMatch(/^## \[Unreleased\]\s*$/m);
  });
});
