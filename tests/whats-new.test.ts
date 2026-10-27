// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0016: What's new is CHANGELOG.md, read into text, never markup, and
// the notes are this version's, or every version's since the one updated from.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, notesFor, parseChangelog, runs, validateWhatsNewCommand, versionAtStart, type VersionRecord } from '../packages/main/whats-new-contract.js';

const changelog = [
  '# Changelog', '', 'Intro text.', '',
  '## [Unreleased]', '', '### Added', '', '- Logbooks.', '',
  '## [0.3.0] - 2026-12-01', '', '- Three.', '',
  '## [0.2.0] - 2026-11-01', '', '### Fixed', '', '- Two, which',
  '  runs on to a second line.', '',
  '## [0.1.0] - 2026-10-30', '', 'First release.', '', '- **One**, with `code` and [a link](https://example.com).', ''
].join('\n');
const sections = parseChangelog(changelog);

describe('reading the changelog', () => {
  it('finds each version, its date, headings, items and paragraphs', () => {
    expect(sections.map(section => [section.version, section.date])).toEqual([
      ['Unreleased', ''], ['0.3.0', '2026-12-01'], ['0.2.0', '2026-11-01'], ['0.1.0', '2026-10-30']]);
    expect(sections[2].blocks).toEqual([
      { kind: 'heading', runs: [{ text: 'Fixed' }] },
      { kind: 'item', runs: [{ text: 'Two, which runs on to a second line.' }] }]);
    expect(sections[3].blocks[0]).toEqual({ kind: 'paragraph', runs: [{ text: 'First release.' }] });
  });

  it('keeps bold and code as runs, a link as its words, and markup as text', () => {
    expect(runs('**One**, with `code` and [a link](https://example.com).')).toEqual([
      { text: 'One', bold: true }, { text: ', with ' }, { text: 'code', code: true }, { text: ' and a link.' }]);
    expect(runs('<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>' }]);
  });

  it('reads the changelog this repository ships', () => {
    expect(parseChangelog(readFileSync('CHANGELOG.md', 'utf8')).length).toBeGreaterThan(0);
  });
});

describe('which notes', () => {
  it('a release: its own, or every one since the version last seen', () => {
    expect(notesFor(sections, '0.3.0', null).sections.map(s => s.version)).toEqual(['0.3.0']);
    expect(notesFor(sections, '0.3.0', '0.1.0').sections.map(s => s.version)).toEqual(['0.3.0', '0.2.0']);
  });

  it('a release after a preview of it: that release\'s notes, and those after the preview (#57, Turing)', () => {
    // A preview of 0.3.0 comes before 0.3.0, so 0.3.0's notes are new.
    expect(notesFor(sections, '0.3.0', '0.3.0-202611150100-abc').sections.map(s => s.version)).toEqual(['0.3.0']);
    expect(notesFor(sections, '0.3.0', '0.2.0-202611010100-abc').sections.map(s => s.version)).toEqual(['0.3.0', '0.2.0']);
  });

  it('a preview, or a version not released yet: what develop has gathered', () => {
    expect(notesFor(sections, '0.4.0-202612020100-abcdef01234', '0.3.0').sections.map(s => s.version)).toEqual(['Unreleased']);
    expect(notesFor(sections, '0.4.0', null).sections.map(s => s.version)).toEqual(['Unreleased']);
  });

  it('a lab build\'s version, up to 60 characters, is accepted (#119)', () => {
    expect(validateWhatsNewCommand({ type: 'notes', since: '0.3.1-local.20261027213534.1ba6a44' })).toBe(true);
    expect(validateWhatsNewCommand({ type: 'notes', since: '1'.repeat(61) })).toBe(false);
  });

  it('accepts a version or none, and nothing else', () => {
    expect(validateWhatsNewCommand({ type: 'notes', since: null })).toBe(true);
    expect(validateWhatsNewCommand({ type: 'notes', since: '0.1.0' })).toBe(true);
    expect(validateWhatsNewCommand({ type: 'notes', since: '../x' })).toBe(false);
    expect(validateWhatsNewCommand({ type: 'notes', since: null, file: 'x' })).toBe(false);
  });
});

describe('the window title names the version', () => {
  it('a release by its version, a preview by the release it leads to', async () => {
    const { windowTitle } = await import('../packages/ui/release.js');
    expect(windowTitle('0.1.0')).toBe('QSO Graph Desktop v0.1.0');
    expect(windowTitle('0.1.1-202610241200-abcdef01234')).toBe('QSO Graph Desktop v0.1.1 preview');
    // A newer Stable release in the title (QGD-FRM-0021, #77), and only a Stable one.
    expect(windowTitle('0.1.2', '0.2.1')).toBe('QSO Graph Desktop v0.1.2 — Update available: v0.2.1');
    expect(windowTitle('0.1.2', '0.3.0-202610260100-0123456789a')).toBe('QSO Graph Desktop v0.1.2');
    expect(windowTitle('0.1.2', undefined)).toBe('QSO Graph Desktop v0.1.2');
    // A validation build by its whole version, so it names the build (#92).
    expect(windowTitle('0.2.1-pr96.c0b8250')).toBe('QSO Graph Desktop v0.2.1-pr96.c0b8250');
    expect(windowTitle('0.2.1-pr96.g0123456')).toBe('QSO Graph Desktop v0.2.1-pr96.g0123456');
    expect(windowTitle('nonsense')).toBe('QSO Graph Desktop');
  });
});

describe('which versions are newer', () => {
  it('by release, then a release after its previews, then previews in order', () => {
    expect(compareVersions('0.3.1', '0.3.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.1', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('0.3.1', '0.3.1-local.20261027213534.1ba6a44')).toBeGreaterThan(0);
    expect(compareVersions('0.3.1-local.20261027213534.1ba6a44', '0.3.1-local.20261027221002.1ba6a44')).toBeLessThan(0);
    expect(compareVersions('0.3.1', '0.3.1')).toBe(0);
    expect(compareVersions('nonsense', '0.3.1')).toBe(0);
  });
});

// What the application records, run by run, and what Home shows at each start.
function run(record: VersionRecord, version: string): { record: VersionRecord; line: ReturnType<typeof versionAtStart>['line'] } {
  const start = versionAtStart(record, version);
  return { record: { ...record, ...start.write }, line: start.line };
}
const closed = (record: VersionRecord, version: string): VersionRecord => ({ ...record, seenVersion: version });

describe('QGD-FRM-0016, #119: an update is from the version last run to this one', () => {
  const fresh: VersionRecord = { lastRunVersion: '', seenVersion: '', updatedFrom: '' };

  it('a new install records its version and shows nothing', () => {
    const first = run(fresh, '0.2.1');
    expect(first.line).toBeNull();
    expect(first.record).toEqual({ lastRunVersion: '0.2.1', seenVersion: '0.2.1', updatedFrom: '' });
    expect(run(first.record, '0.2.1').line).toBeNull();
  });

  it('KI7MT\'s test VM: 0.2.1 → 0.3.0 → 0.2.1 → 0.3.0 → 0.3.1, never closed, ends on 0.3.1\'s notes alone', () => {
    let state = run(fresh, '0.2.1');
    state = run(state.record, '0.3.0');
    expect(state.line).toEqual({ from: '0.2.1', back: false });
    state = run(state.record, '0.2.1');
    expect(state.line).toEqual({ from: '0.3.0', back: true });
    state = run(state.record, '0.3.0');
    expect(state.line).toEqual({ from: '0.2.1', back: false });
    state = run(state.record, '0.3.1');
    expect(state.line).toEqual({ from: '0.3.0', back: false });
    expect(notesFor(sections3(), '0.3.1', state.line?.from ?? null).sections.map(s => s.version)).toEqual(['0.3.1']);
  });

  it('an update across several releases shows each one in between', () => {
    const state = run(run(fresh, '0.1.0').record, '0.3.0');
    expect(state.line).toEqual({ from: '0.1.0', back: false });
    expect(notesFor(sections, '0.3.0', state.line?.from ?? null).sections.map(s => s.version)).toEqual(['0.3.0', '0.2.0']);
  });

  it('the line stays across restarts until it is closed, and closed stays closed', () => {
    let state = run(run(fresh, '0.2.0').record, '0.3.0');
    state = run(state.record, '0.3.0');
    expect(state.line).toEqual({ from: '0.2.0', back: false });
    state = run(closed(state.record, '0.3.0'), '0.3.0');
    expect(state.line).toBeNull();
  });

  it('an install from before the last version was kept shows the running release\'s own notes', () => {
    // 0.3.1 never kept lastRunVersion; its line was last closed at 0.1.3.
    const state = run({ lastRunVersion: '', seenVersion: '0.1.3', updatedFrom: '' }, '0.4.0');
    expect(state.line).toEqual({ from: null, back: false });
    expect(state.record.lastRunVersion).toBe('0.4.0');
    expect(run({ lastRunVersion: '', seenVersion: '0.4.0', updatedFrom: '' }, '0.4.0').line).toBeNull();
  });
});

// The release notes KI7MT's VM went through.
function sections3() {
  return parseChangelog(['## [0.3.1] - 2026-10-27', '', '- Security.', '', '## [0.3.0] - 2026-10-26', '', '- Backup.', '',
    '## [0.2.1] - 2026-10-25', '', '- Fixes.', ''].join('\n'));
}
