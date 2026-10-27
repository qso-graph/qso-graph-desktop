// SPDX-License-Identifier: GPL-3.0-only
// The release steps that are text (scripts/release.mjs, docs/RELEASES.md):
// the notes a release publishes are its CHANGELOG section, and main builds a
// release only when that section is there.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, feedEntry, isRelease, LISTED_STABLE, listEntry, listed, next, notes, prepare, releaseState, resumePlan, tracks, withEntry, withListed, withVersion } from '../scripts/release.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { choose, compareVersions, isVersionChoices, readFeed, versionChoices } from '../packages/main/update-contract.js';

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

  it('changes the version lines and nothing else, not even a dependency at the same version', () => {
    const lock = '{\n  "version": "0.1.0",\n  "packages": {\n    "": {\n      "version": "0.1.0"\n    },\n    "node_modules/x": {\n      "version": "0.1.0"\n    }\n  }\n}\n';
    expect(withVersion(lock, '0.1.0', '0.1.1', 2)).toBe(lock.replace('"version": "0.1.0"', '"version": "0.1.1"').replace('"version": "0.1.0"', '"version": "0.1.1"'));
    expect(withVersion(lock, '0.1.0', '0.1.1', 2)).toContain('"node_modules/x": {\n      "version": "0.1.0"');
    expect(() => withVersion('{}', '0.1.0', '0.1.1', 1)).toThrow(/fewer than 1/);
  });

  it('moves to the next version', () => {
    expect(next('0.1.0', 'minor')).toBe('0.2.0');
    expect(next('0.1.0', 'patch')).toBe('0.1.1');
    expect(next('0.9.3', 'major')).toBe('1.0.0');
    expect(() => next('0.1.0', 'tiny')).toThrow(/major, minor or patch/);
  });

  it('writes a feed entry the application reads, from the release\'s own sums', () => {
    const sums = ['win-x64.exe', 'linux-x86_64.AppImage', 'linux-arm64.AppImage', 'linux-x64.zip', 'mac-arm64.zip', 'mac-arm64.dmg']
      .map((tail, at) => `${String(at).repeat(64)}  qso-graph-desktop-0.1.1-${tail}`).join('\n');
    const feed = withEntry(withEntry(undefined, 'stable', feedEntry('0.1.1', sums)), 'early', null);
    expect(feed.stable.files['linux-arm64'].sha256).toBe('2'.repeat(64));
    expect(feed.stable.files['mac-arm64'].name).toBe('qso-graph-desktop-0.1.1-mac-arm64.zip');
    expect(Object.keys(feed.stable.files)).not.toContain('linux-x64');
    expect(feed.stable.files['win-x64'].url).toBe('https://github.com/qso-graph/qso-graph-desktop/releases/download/v0.1.1/qso-graph-desktop-0.1.1-win-x64.exe');
    const read = readFeed(new TextEncoder().encode(JSON.stringify(feed)));
    expect(choose(read, 'stable', '0.1.0').files['linux-x86_64'].sha256).toBe('1'.repeat(64));
    expect(() => feedEntry('0.1.2', sums)).toThrow(/does not list/);
    expect(() => withEntry(feed, 'preview', null)).toThrow(/stable or early/);
  });

  it('this repository has a version and a changelog the steps can read', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    expect(isRelease(version), version).toBe(true);
    expect(readFileSync('CHANGELOG.md', 'utf8')).toMatch(/^## \[Unreleased\]\s*$/m);
  });
});

describe('which version each update track names (#94)', () => {
  const release = (tagName, isPrerelease, isLatest = false, isDraft = false) => ({ tagName, isPrerelease, isLatest, isDraft });

  it('Stable is the release marked Latest; Early the newest of either kind', () => {
    expect(tracks([release('v0.2.1', true), release('v0.2.0', false, true), release('v0.1.3', false)]))
      .toEqual({ stable: '0.2.0', early: '0.2.1' });
  });

  it('Early is Stable when nothing newer is out, and compares numbers, not text', () => {
    expect(tracks([release('v0.10.0', false, true), release('v0.9.0', true)])).toEqual({ stable: '0.10.0', early: '0.10.0' });
  });

  it('a Preview, a draft and a pre-release are never Stable; nothing out is null', () => {
    expect(tracks([release('v0.2.1-preview', true), release('v0.3.0', false, false, true), release('v0.2.0', true)]))
      .toEqual({ stable: null, early: '0.2.0' });
    expect(tracks([])).toEqual({ stable: null, early: null });
  });

  it('a tag that is not vMAJOR.MINOR.PATCH is not a release', () => {
    expect(tracks([release('preview', true), release('v01.2.3', false, true), release('0.4.0', false)])).toEqual({ stable: null, early: null });
  });
});

// Choose a version… (#77): the list the feed carries, from the published
// releases, read back by the application as it is written.
describe('the feed\'s list of versions (#77)', () => {
  const sumsFor = version => ['win-x64.exe', 'linux-x86_64.AppImage', 'linux-arm64.AppImage', 'mac-arm64.zip']
    .map(tail => `${'b'.repeat(64)}  qso-graph-desktop-${version}-${tail}`).join('\n');
  const at = (tagName, isPrerelease, publishedAt = '2026-10-25T00:00:00Z') => ({ tagName, isPrerelease, isDraft: false, isLatest: false, publishedAt });

  it('lists the last Stable releases, the newest Early and the Preview, while each leads somewhere', () => {
    const releases = [at('v0.2.1', false), at('v0.2.0', true), at('v0.1.3', true), at('v0.3.0-preview', true), at('v0.2.0-preview', true)];
    expect(listed(releases).map(entry => `${entry.track} ${entry.tag}`)).toEqual(['stable v0.2.1', 'preview v0.3.0-preview']);
    const many = Array.from({ length: 14 }, (_, n) => at(`v0.1.${n}`, false));
    expect(listed(many).length).toBe(LISTED_STABLE);
    expect(listed(many)[0].tag).toBe('v0.1.13');
    expect(listed([...many, at('v0.2.0', true)]).at(-1)).toMatchObject({ track: 'early', tag: 'v0.2.0' });
  });

  it('writes a list the application reads, a Preview under its own tag', () => {
    const preview = '0.3.0-202610260100-0123456789a';
    let feed = withListed(undefined, listEntry('stable', 'v0.2.1', '2026-10-25T22:31:47Z', sumsFor('0.2.1')));
    feed = withListed(feed, listEntry('preview', 'v0.3.0-preview', '2026-10-26T01:00:00Z', sumsFor(preview)));
    feed = withListed(feed, listEntry('stable', 'v0.2.2', '2026-10-26T00:00:00Z', sumsFor('0.2.2')));
    expect(feed.releases.map(entry => entry.version)).toEqual([preview, '0.2.2', '0.2.1']);
    expect(feed.releases[0].files['win-x64'].url).toBe(`https://github.com/qso-graph/qso-graph-desktop/releases/download/v0.3.0-preview/qso-graph-desktop-${preview}-win-x64.exe`);
    const read = readFeed(new TextEncoder().encode(JSON.stringify(feed)));
    expect(read.releases.map(entry => entry.version)).toEqual([preview, '0.2.2', '0.2.1']);
    const choices = versionChoices(read, 'preview', '0.2.2', ['0.2.1']);
    expect(choices.map(choice => `${choice.version}:${choice.way}:${choice.snapshot}`)).toEqual([`${preview}:forward:false`, '0.2.2:running:false', '0.2.1:back:true']);
    expect(isVersionChoices(choices)).toBe(true);
    expect(choose(read, 'preview', '0.2.2').version).toBe(preview);
    expect(choose(read, 'stable', '0.2.2')).toBe(null);
  });

  it('a feed an older copy reads is unchanged by the list', () => {
    const feed = withListed(withEntry(undefined, 'stable', feedEntry('0.2.1', sumsFor('0.2.1'))), listEntry('stable', 'v0.2.1', '2026-10-25T22:31:47Z', sumsFor('0.2.1')));
    expect(Object.keys(feed)).toEqual(['format', 'version', 'stable', 'early', 'releases']);
    expect(feed.version).toBe(1);
  });

  it('refuses what is not what it says it is', () => {
    expect(() => listEntry('preview', 'v0.3.0-preview', '2026-10-26', sumsFor('0.3.0'))).toThrow(/no Preview/);
    expect(() => listEntry('stable', 'v0.2.2', 'yesterday', sumsFor('0.2.2'))).toThrow(/not a date/);
    expect(() => listEntry('nightly', 'v0.2.2', '2026-10-26', sumsFor('0.2.2'))).toThrow(/which track/);
    const bad = { format: 'qso-graph-desktop-updates', version: 1, stable: null, early: null, releases: [
      { ...listEntry('stable', 'v0.2.1', '2026-10-25', sumsFor('0.2.1')), track: 'preview' },
      { ...listEntry('stable', 'v0.2.1', '2026-10-25', sumsFor('0.2.1')), extra: 1 }
    ] };
    expect(readFeed(new TextEncoder().encode(JSON.stringify(bad))).releases).toEqual([]);
  });

  it('a Preview comes before the release it leads to, and after an older Preview of it', () => {
    expect(compareVersions('0.3.0-202610260100-0123456789a', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('0.3.0-202610260100-0123456789a', '0.2.1')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0-202610260100-0123456789a', '0.3.0-202610270100-0123456789b')).toBeLessThan(0);
  });
});

// #118: a release that failed past publishing is finished by running Release
// again, from the build it began with, and anything else stops. Each state as
// GitHub states it: `gh release view --json tagName,isDraft` prints
// {"isDraft":false,"tagName":"v0.4.0"}, or fails with "release not found"
// (the workflow passes "-"); `git ls-remote` gives the tag's commit, or nothing.
describe('#118: where a release stands', () => {
  const built = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  const published = { isDraft: false, tagName: 'v0.4.0' };

  it('no release and no tag: a new release', () => {
    expect(releaseState('0.4.0', built, null, '')).toEqual({ state: 'new' });
  });
  it('a release and its tag, on the build: finished from where it stopped', () => {
    expect(releaseState('0.4.0', built, published, built)).toEqual({ state: 'existing' });
  });
  it('a tag with nothing behind it: stop, rather than guess', () => {
    expect(releaseState('0.4.0', built, null, built).state).toBe('stop');
  });
  it('tagged on another commit: stop, since it is not this build', () => {
    expect(releaseState('0.4.0', built, published, other)).toMatchObject({ state: 'stop', reason: expect.stringMatching(/bbbbbbb.*aaaaaaa/) });
  });
  it('a draft, a release with no tag, or another tag: stop', () => {
    expect(releaseState('0.4.0', built, { ...published, isDraft: true }, built).state).toBe('stop');
    expect(releaseState('0.4.0', built, published, '').state).toBe('stop');
    expect(releaseState('0.4.0', built, { ...published, tagName: 'v0.3.1' }, built).state).toBe('stop');
  });

  it('the command, as the workflow runs it: state= on stdout, or a reason and exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    const file = join(dir, 'release.json');
    writeFileSync(file, JSON.stringify(published));
    const run = (...args) => execFileSync('node', ['scripts/release.mjs', 'state', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(run('0.4.0', built, '-', '-')).toBe('state=new\n');
    expect(run('0.4.0', built, built, file)).toBe('state=existing\n');
    expect(() => run('0.4.0', built, built, '-')).toThrow(/no release behind it/);
    expect(() => run('0.4.0', 'not-a-sha', '-', '-')).toThrow(/Usage/);
  });
});

describe('#118: what an existing release still needs', () => {
  const sums = (...rows) => rows.map(([hash, name]) => `${hash.repeat(64)}  ${name}`).join('\n');
  const build = sums(['1', 'qso-graph-desktop-0.4.0-win-x64.exe'], ['2', 'qso-graph-desktop-0.4.0-mac-arm64.dmg'], ['3', 'SHA256SUMS.txt']);

  it('the files it lacks, and only those', () => {
    expect(resumePlan(build, sums(['1', 'qso-graph-desktop-0.4.0-win-x64.exe']))).toEqual(['qso-graph-desktop-0.4.0-mac-arm64.dmg', 'SHA256SUMS.txt']);
    expect(resumePlan(build, '')).toHaveLength(3);
    expect(resumePlan(build, build)).toEqual([]);
  });
  it('refuses a file that is not the build\'s, or one the build does not have: nothing is replaced', () => {
    expect(() => resumePlan(build, sums(['9', 'qso-graph-desktop-0.4.0-win-x64.exe']))).toThrow(/not the build's file/);
    expect(() => resumePlan(build, sums(['4', 'qso-graph-desktop-0.3.9-win-x64.exe']))).toThrow(/not in the build/);
  });
  it('refuses an empty build', () => {
    expect(() => resumePlan('', '')).toThrow(/lists no files/);
  });
});
