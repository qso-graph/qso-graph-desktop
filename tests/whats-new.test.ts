// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0016: What's new is CHANGELOG.md, read into text, never markup, and
// the notes are this version's, or every version's since the one last seen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notesFor, parseChangelog, runs, validateWhatsNewCommand } from '../packages/main/whats-new-contract.js';

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
    // A validation build by its whole version, so it names the build (#92).
    expect(windowTitle('0.2.1-pr96.c0b8250')).toBe('QSO Graph Desktop v0.2.1-pr96.c0b8250');
    expect(windowTitle('0.2.1-pr96.g0123456')).toBe('QSO Graph Desktop v0.2.1-pr96.g0123456');
    expect(windowTitle('nonsense')).toBe('QSO Graph Desktop');
  });
});
