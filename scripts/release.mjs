// SPDX-License-Identifier: GPL-3.0-or-later
// The release steps that are text, not builds (docs/RELEASES.md).
//
//   node scripts/release.mjs prepare            the milestone's branch, once its
//                                               issues are closed: [Unreleased]
//                                               becomes this version and today's
//                                               date, under a new empty [Unreleased]
//   node scripts/release.mjs check              the Release workflow: the version is
//                                               a release with its CHANGELOG
//                                               section, or a Beta (#157) with
//                                               something under [Unreleased]
//   node scripts/release.mjs notes <version>    that section, the release's notes
//   node scripts/release.mjs downloads <version> <folder>   the Quick downloads, from the files
//   node scripts/release.mjs next <minor|patch|major>
//                                               a new milestone's branch: its version
//                                               in package.json and its lock
//   node scripts/release.mjs tracks <releases.json>
//                                               which version each update track
//                                               names, from the published releases
//                                               (gh release list --json), as
//                                               stable=… and early=… lines
//   node scripts/release.mjs feed <early|stable> <version> <SHA256SUMS.txt> <desktop.json>
//                                               the update feed's entry for a track,
//                                               from what the release published
//   node scripts/release.mjs listed <releases.json>
//                                               which releases the feed lists (#77),
//                                               as "<track> <tag> <date>" lines
//   node scripts/release.mjs list <track> <tag> <date> <SHA256SUMS.txt> <desktop.json>
//                                               one of them added to the feed's list
//   node scripts/release.mjs state <version> <built> <tag-commit|-> <release.json|->
//                                               where a release stands (#118): new, or
//                                               existing and to be finished, as state=…
//   node scripts/release.mjs resume <expected-sums> <present-sums>
//                                               the files an existing release lacks, one
//                                               a line; refuses a file that differs
//
// Offline, and it changes nothing but CHANGELOG.md, package.json and
// package-lock.json. The workflow asks GitHub about the tag and the release;
// what follows from the answers is decided here, where it is tested.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isRelease(version) {
  return RELEASE.test(version);
}

// A Beta (#157): the release it leads to and its number,
// 0.6.0-beta.1. Published as a pre-release, offered on the Beta track only.
const BETA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d{0,2})$/;
export function isBeta(version) {
  return BETA.test(version);
}

// What the Release workflow publishes: a release or a Beta.
export function isPublishable(version) {
  return isRelease(version) || isBeta(version);
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The body under `## [version] - date`, up to the next `## `. Undefined when
// the version has no section.
export function notes(changelog, version) {
  if (isBeta(version)) return unreleased(changelog);
  const lines = changelog.split('\n');
  const heading = new RegExp(`^## \\[${escape(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

// "Quick downloads" at the top of a release's page: the file for each
// computer, so nobody reads a list of thirteen to find theirs
// (after WSJT-X's release pages). Windows first, then Linux, then
// macOS. Only the files the release has are listed, from their own names.
const DOWNLOAD = 'https://github.com/qso-graph/qso-graph-desktop/releases/download';
const INSTALL = 'https://github.com/qso-graph/qso-graph-desktop/blob/main/guide/install.md';
export function quickDownloads(version, files) {
  const has = new Set(files);
  const link = (label, suffix) => {
    const name = `qso-graph-desktop-${version}-${suffix}`;
    return has.has(name) ? `[${label}](${DOWNLOAD}/v${version}/${name})` : undefined;
  };
  const row = (label, links, after = '') => {
    const present = links.filter(Boolean);
    return present.length ? `- ${label}: ${present.join(' · ')}${after}` : undefined;
  };
  const sections = [
    ['Windows', [
      row('Installer', [link('64-bit .exe', 'win-x64.exe')]),
      row('Portable', [link('.zip', 'win-x64.zip')])
    ]],
    ['Linux', [
      row('AppImage', [link('x86_64', 'linux-x86_64.AppImage'), link('arm64 (Raspberry Pi 5)', 'linux-arm64.AppImage')]),
      row('Debian, Ubuntu (.deb)', [link('amd64', 'linux-amd64.deb'), link('arm64', 'linux-arm64.deb')], `, or [our apt repository](${INSTALL}#linux) (Releases only)`),
      row('Fedora, RHEL, Rocky (.rpm)', [link('x86_64', 'linux-x86_64.rpm'), link('aarch64', 'linux-aarch64.rpm')], `, or [our dnf repository](${INSTALL}#linux) (Releases only)`),
      row('Portable', [link('x64 .zip', 'linux-x64.zip'), link('arm64 .zip', 'linux-arm64.zip')])
    ]],
    ['macOS', [
      row('Apple silicon', [link('.dmg', 'mac-arm64.dmg'), link('portable .zip', 'mac-arm64.zip')], has.has(`qso-graph-desktop-${version}-mac-arm64.dmg`) ? ', or `brew install qso-graph/tap/qso-graph-desktop` (Releases only)' : '')
    ]]
  ];
  const body = sections
    .map(([name, rows]) => [name, rows.filter(Boolean)])
    .filter(([, rows]) => rows.length)
    .map(([name, rows]) => `### ${name}\n\n${rows.join('\n')}`);
  return body.length ? `## Quick downloads\n\n${body.join('\n\n')}` : '';
}

// [Unreleased] renamed to the version and date, with an empty [Unreleased]
// above it for what lands next.
export function prepare(changelog, version, date) {
  if (!isRelease(version)) throw new Error(`${version} is not a release version (MAJOR.MINOR.PATCH).`);
  if (notes(changelog, version) !== undefined) throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  const heading = /^## \[Unreleased\][ \t]*$/m;
  if (!heading.test(changelog)) throw new Error('CHANGELOG.md has no [Unreleased] section.');
  return changelog.replace(heading, `## [Unreleased]\n\n## [${version}] - ${date}`);
}

// The body under `## [Unreleased]`, up to the next `## `.
export function unreleased(changelog) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => /^## \[Unreleased\]\s*$/.test(line));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

export function check(changelog, version) {
  // A Beta's notes are what [Unreleased] holds so far: the release it leads
  // to gets its own section only when it is prepared.
  if (isBeta(version)) {
    const body = unreleased(changelog);
    if (body === undefined) return 'CHANGELOG.md has no [Unreleased] section.';
    if (body === '') return `CHANGELOG.md's [Unreleased] is empty: a Beta says what it brings.`;
    return undefined;
  }
  if (!isRelease(version)) return `${version} is not a release version: main builds MAJOR.MINOR.PATCH, or MAJOR.MINOR.PATCH-beta.N.`;
  const body = notes(changelog, version);
  if (body === undefined) return `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section: run "node scripts/release.mjs prepare" on the milestone's branch first.`;
  if (body === '') return `CHANGELOG.md's section for ${version} is empty.`;
  return undefined;
}

export function next(version, part) {
  const match = RELEASE.exec(version);
  if (!match) throw new Error(`${version} is not a release version (MAJOR.MINOR.PATCH).`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error('Say which part: major, minor or patch.');
}

// The update feed (QGD-FRM-0019, docs/RELEASES.md): each track names a
// version and, for each build that installs itself, its file, where it is
// and its SHA-256, read from the release's own SHA256SUMS.txt.
export const FEED_FORMAT = 'qso-graph-desktop-updates';
export const RELEASE_DOWNLOADS = 'https://github.com/qso-graph/qso-graph-desktop/releases/download';
const SELF_UPDATING = {
  'win-x64': 'win-x64.exe', 'linux-x86_64': 'linux-x86_64.AppImage', 'linux-arm64': 'linux-arm64.AppImage',
  'mac-arm64': 'mac-arm64.zip'
};

// A Daily's version (#157): the release it leads to, the commit's UTC date and
// time, and the commit (ci.yml, "Daily version"). Never in the feed.
const DAILY = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-\d{12}-[0-9a-f]{11}$/;
export function isDaily(version) {
  return DAILY.test(version);
}

export function feedEntry(version, sums, tag = `v${version}`) {
  if (!isPublishable(version)) throw new Error(`${version} is not a release or a Beta (MAJOR.MINOR.PATCH, or -beta.N).`);
  const listed = new Map();
  for (const line of sums.split('\n')) {
    const match = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(line.trim());
    if (match) listed.set(match[2], match[1]);
  }
  const files = {};
  for (const [platform, tail] of Object.entries(SELF_UPDATING)) {
    const name = `qso-graph-desktop-${version}-${tail}`;
    const sha256 = listed.get(name);
    if (!sha256) throw new Error(`SHA256SUMS.txt does not list ${name}.`);
    files[platform] = { name, url: `${RELEASE_DOWNLOADS}/${tag}/${name}`, sha256 };
  }
  return { version, files };
}

export function withEntry(feed, track, entry) {
  if (track !== 'stable' && track !== 'early') throw new Error('Say which track: stable or early.');
  const base = feed && feed.format === FEED_FORMAT ? feed : { format: FEED_FORMAT, version: 1, stable: null, early: null };
  return { ...base, [track]: entry };
}

// The feed's list (#77, #157): what Choose a version… offers. On the Release
// track ('stable'), the current release and the one before, and nothing older;
// going back is to a release only (QGD-FRM-0020). On the
// Beta track ('early'), the Betas of the next release and nothing else: once it
// is out they leave the list. A Daily is never listed. The feed stays small
// (data/update-sources.json's maxFeedBytes): about 1.3 KB an entry.
export const LISTED_STABLE = 2;
// The most Betas one release lists, newest first.
export const LISTED_BETAS = 20;
const TRACK_RANK = { stable: 0, early: 1 };

// Newer first is b before a. A Beta comes before the release it leads to, and
// after the Betas numbered below it.
export function versionOrder(a, b) {
  const [x, y] = [a, b].map(v => v.split('-')[0].split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  const rank = v => { const beta = BETA.exec(v); return beta ? Number(beta[4]) : Infinity; };
  const [p, q] = [rank(a), rank(b)];
  return p === q ? 0 : p < q ? -1 : 1;
}

const core = version => version.split('-')[0];

export function listed(releases) {
  const out = [];
  const live = releases.filter(release => !release.isDraft && typeof release.tagName === 'string');
  const plain = live.filter(release => /^v\d+\.\d+\.\d+$/.test(release.tagName) && isRelease(release.tagName.slice(1)));
  const stable = plain.filter(release => !release.isPrerelease)
    .sort((a, b) => versionOrder(b.tagName.slice(1), a.tagName.slice(1))).slice(0, LISTED_STABLE);
  for (const release of stable) out.push({ track: 'stable', tag: release.tagName, date: release.publishedAt });
  const newestStable = stable[0]?.tagName.slice(1) ?? '0.0.0';
  // The next release's Betas: those leading to the newest release not yet out.
  const betas = live.filter(release => release.isPrerelease && /^v\d+\.\d+\.\d+-beta\.\d+$/.test(release.tagName) && isBeta(release.tagName.slice(1)))
    .filter(release => versionOrder(core(release.tagName.slice(1)), newestStable) > 0);
  const target = betas.map(release => core(release.tagName.slice(1))).sort((a, b) => versionOrder(b, a))[0];
  for (const release of betas.filter(release => core(release.tagName.slice(1)) === target)
    .sort((a, b) => versionOrder(b.tagName.slice(1), a.tagName.slice(1))).slice(0, LISTED_BETAS)) {
    out.push({ track: 'early', tag: release.tagName, date: release.publishedAt });
  }
  return out;
}

export function listEntry(track, tag, date, sums) {
  if (!(track in TRACK_RANK)) throw new Error('Say which track: stable or early.');
  if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) throw new Error(`${date} is not a date.`);
  const version = tag.replace(/^v/, '');
  if (tag !== `v${version}` || (track === 'stable' ? !isRelease(version) : !isBeta(version))) throw new Error(`${tag} is not a ${track === 'stable' ? 'release' : 'Beta'} tag.`);
  return { ...feedEntry(version, sums, tag), track, date: new Date(date).toISOString() };
}

// Newest first.
export function withListed(feed, entry) {
  const base = feed && feed.format === FEED_FORMAT ? feed : { format: FEED_FORMAT, version: 1, stable: null, early: null };
  const releases = [...(base.releases ?? []).filter(other => other.version !== entry.version), entry]
    .sort((a, b) => versionOrder(b.version, a.version) || TRACK_RANK[a.track] - TRACK_RANK[b.track]);
  return { ...base, releases };
}

// Which version each track names (#94, #157), worked out from the published
// releases each time, so the feed holds no state of its own and is never
// edited by hand: the Release track ('stable') is the release GitHub marks
// Latest; the Beta track ('early') is the newest of the releases and the
// Betas, so it is the Release when no newer Beta is out. Drafts, Dailies and
// anything not tagged vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-beta.N are
// neither. A track with none is null.
export function tracks(releases) {
  const published = releases
    .filter(release => !release.isDraft && /^v\d+\.\d+\.\d+(-beta\.\d+)?$/.test(release.tagName) && isPublishable(release.tagName.slice(1)))
    // A Beta is published as a pre-release; one that is not is not a Beta.
    .filter(release => !isBeta(release.tagName.slice(1)) || release.isPrerelease)
    .map(release => ({ ...release, version: release.tagName.slice(1) }));
  const latest = published.find(release => release.isLatest && !release.isPrerelease && isRelease(release.version));
  const early = published.reduce((best, release) => (best && versionOrder(best.version, release.version) >= 0 ? best : release), undefined);
  return { stable: latest ? latest.version : null, early: early ? early.version : null };
}

// The first `count` "version": "<from>" lines become `to`: package.json has
// one, its lock two (the lock's own, and the root package's).
export function withVersion(text, from, to, count) {
  let left = count;
  const out = text.replace(new RegExp(`"version": "${escape(from)}"`, 'g'), found => (left-- > 0 ? `"version": "${to}"` : found));
  if (left > 0) throw new Error(`Found fewer than ${count} version lines reading ${from}.`);
  return out;
}

// Where a release stands (#118), from the release (null when there is none) and
// the commit its tag points to ('' when there is no tag). A release failing past
// publishing left a tag and a release, perhaps with some files, and the gate
// refused "already tagged", so it could not be finished:
//   no release, no tag              new
//   release and tag, on the build   existing: upload what is missing, then the
//                                   milestone and the feed, which repeat safely
//   anything else                   stop, and say what is there
export function releaseState(version, built, release, tagCommit) {
  const tag = `v${version}`;
  if (!release && !tagCommit) return { state: 'new' };
  if (!release) return { state: 'stop', reason: `${tag} is tagged on ${tagCommit.slice(0, 7)} with no release behind it: not guessing what it is. Delete the tag, or make its release, by hand.` };
  if (release.tagName !== tag) return { state: 'stop', reason: `GitHub answered with ${release.tagName} for ${tag}.` };
  if (release.isDraft === true) return { state: 'stop', reason: `${tag} is a draft release. Publish or delete it by hand.` };
  if (!tagCommit) return { state: 'stop', reason: `${tag} is a release with no tag.` };
  if (tagCommit !== built) return { state: 'stop', reason: `${tag} is tagged on ${tagCommit.slice(0, 7)}, but CI's build is ${built.slice(0, 7)}: a release is finished only from the build it began with.` };
  return { state: 'existing' };
}

function sumsMap(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(line.trim());
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

// What an existing release needs (#118): the files the build has and the release
// lacks. A file on the release that differs from the build's, or that the build
// does not have, is refused: it is not this build's, and nothing is replaced.
export function resumePlan(expectedSums, presentSums) {
  const expected = sumsMap(expectedSums);
  const present = sumsMap(presentSums);
  if (expected.size === 0) throw new Error('The build lists no files.');
  const upload = [...expected.keys()].filter(name => !present.has(name));
  const differ = [...present.keys()].filter(name => expected.has(name) && expected.get(name) !== present.get(name));
  const extra = [...present.keys()].filter(name => !expected.has(name));
  if (differ.length || extra.length) {
    throw new Error([
      ...differ.map(name => `${name} on the release is not the build's file.`),
      ...extra.map(name => `${name} is on the release and not in the build.`),
    ].join('\n'));
  }
  return upload;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main([command, argument]) {
  if (command === 'tracks') {
    if (!argument) { console.error('Usage: node scripts/release.mjs tracks <releases.json>'); return 2; }
    const { stable, early } = tracks(readJson(argument));
    process.stdout.write(`stable=${stable ?? ''}\nearly=${early ?? ''}\n`);
    return 0;
  }
  if (command === 'listed') {
    if (!argument) { console.error('Usage: node scripts/release.mjs listed <releases.json>'); return 2; }
    for (const { track, tag, date } of listed(readJson(argument))) process.stdout.write(`${track} ${tag} ${date}\n`);
    return 0;
  }
  if (command === 'list') {
    const [, track, tag, date, sumsFile, feedFile] = process.argv.slice(2);
    if (!feedFile) { console.error('Usage: node scripts/release.mjs list <track> <tag> <date> <SHA256SUMS.txt> <desktop.json>'); return 2; }
    let feed;
    try { feed = readJson(feedFile); } catch { feed = undefined; }
    writeJson(feedFile, withListed(feed, listEntry(track, tag, date, readFileSync(sumsFile, 'utf8'))));
    console.log(`${feedFile}: lists ${tag} (${track}).`);
    return 0;
  }
  if (command === 'state') {
    const [, version, built, tagCommit, releaseFile] = process.argv.slice(2);
    if (!releaseFile || !isPublishable(version) || !/^[0-9a-f]{40}$/.test(built) || !(tagCommit === '-' || /^[0-9a-f]{40}$/.test(tagCommit))) {
      console.error('Usage: node scripts/release.mjs state <version> <built> <tag-commit|-> <release.json|->'); return 2;
    }
    const result = releaseState(version, built, releaseFile === '-' ? null : readJson(releaseFile), tagCommit === '-' ? '' : tagCommit);
    if (result.state === 'stop') { console.error(result.reason); return 1; }
    process.stdout.write(`state=${result.state}\n`);
    return 0;
  }
  if (command === 'downloads') {
    const [, given, folder] = process.argv.slice(2);
    if (!given || !folder || !isPublishable(given)) { console.error('Usage: node scripts/release.mjs downloads <version> <folder of the release\'s files>'); return 2; }
    process.stdout.write(`${quickDownloads(given, readdirSync(folder))}\n`);
    return 0;
  }
  if (command === 'resume') {
    const [, expectedFile, presentFile] = process.argv.slice(2);
    if (!presentFile) { console.error('Usage: node scripts/release.mjs resume <expected-sums> <present-sums>'); return 2; }
    for (const name of resumePlan(readFileSync(expectedFile, 'utf8'), readFileSync(presentFile, 'utf8'))) process.stdout.write(`${name}\n`);
    return 0;
  }
  const version = readJson('package.json').version;
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  switch (command) {
    case 'prepare': {
      const date = new Date().toISOString().slice(0, 10);
      writeFileSync('CHANGELOG.md', prepare(changelog, version, date));
      console.log(`CHANGELOG.md: [Unreleased] is now [${version}] - ${date}.`);
      return 0;
    }
    case 'check': {
      const problem = check(changelog, version);
      if (problem) { console.error(problem); return 1; }
      console.log(`${version} is ready to release.`);
      return 0;
    }
    case 'notes': {
      const body = notes(changelog, argument ?? version);
      if (body === undefined) { console.error(`CHANGELOG.md has no section for ${argument ?? version}.`); return 1; }
      process.stdout.write(`${body}\n`);
      return 0;
    }
    case 'next': {
      const to = next(version, argument);
      // The version line alone, as written: the rest of each file is left
      // exactly as it was, so the commit is the version and nothing else.
      writeFileSync('package.json', withVersion(readFileSync('package.json', 'utf8'), version, to, 1));
      writeFileSync('package-lock.json', withVersion(readFileSync('package-lock.json', 'utf8'), version, to, 2));
      console.log(`package.json: ${version} → ${to}.`);
      return 0;
    }
    case 'feed': {
      const [, track, release, sumsFile, feedFile] = process.argv.slice(2);
      if (!feedFile) { console.error('Usage: node scripts/release.mjs feed <early|stable> <version> <SHA256SUMS.txt> <desktop.json>'); return 2; }
      let feed;
      try { feed = readJson(feedFile); } catch { feed = undefined; }
      writeJson(feedFile, withEntry(feed, track, feedEntry(release, readFileSync(sumsFile, 'utf8'))));
      console.log(`${feedFile}: ${track} is now ${release}.`);
      return 0;
    }
    default:
      console.error('Usage: node scripts/release.mjs prepare | check | notes [version] | downloads <version> <folder> | next <major|minor|patch> | tracks <releases.json> | feed <track> <version> <sums> <feed> | listed <releases.json> | list <track> <tag> <date> <sums> <feed> | state <version> <built> <tag-commit|-> <release.json|-> | resume <expected-sums> <present-sums>');
      return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
