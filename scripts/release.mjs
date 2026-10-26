// SPDX-License-Identifier: GPL-3.0-only
// The release steps that are text, not builds (docs/RELEASES.md).
//
//   node scripts/release.mjs prepare            the milestone's branch, once its
//                                               issues are closed: [Unreleased]
//                                               becomes this version and today's
//                                               date, under a new empty [Unreleased]
//   node scripts/release.mjs check              the Release workflow: the version is
//                                               a plain release and CHANGELOG has
//                                               its section
//   node scripts/release.mjs notes <version>    that section, the release's notes
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
//
// Offline, and it changes nothing but CHANGELOG.md, package.json and
// package-lock.json. Whether the tag is already taken is the workflow's
// question: it is the one that can ask GitHub.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isRelease(version) {
  return RELEASE.test(version);
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The body under `## [version] - date`, up to the next `## `. Undefined when
// the version has no section.
export function notes(changelog, version) {
  const lines = changelog.split('\n');
  const heading = new RegExp(`^## \\[${escape(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
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

export function check(changelog, version) {
  if (!isRelease(version)) return `${version} is not a release version: main builds MAJOR.MINOR.PATCH only.`;
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

// A Preview's version: the release it leads to, the commit's UTC date and
// time, and the commit (ci.yml, "Preview version").
const PREVIEW = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-\d{12}-[0-9a-f]{11}$/;
export function isPreview(version) {
  return PREVIEW.test(version);
}

// A Preview's version, read from its own files: its tag names only the
// release it leads to.
export function previewVersion(sums) {
  const found = /qso-graph-desktop-(\S+)-linux-x86_64\.AppImage/.exec(sums);
  if (!found || !isPreview(found[1])) throw new Error('SHA256SUMS.txt names no Preview AppImage.');
  return found[1];
}

export function feedEntry(version, sums, tag = `v${version}`) {
  if (!isRelease(version) && !isPreview(version)) throw new Error(`${version} is not a release version (MAJOR.MINOR.PATCH).`);
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

// The feed's list (#77): what Choose a version… offers. Forward is the
// newest of each track; back is Stable only (KI7MT, 2026-10-26: "a
// definitive target to hit"), so the last few Stable releases are listed and
// no older Early or Preview. The feed stays small (data/update-sources.json's
// maxFeedBytes): about 1.3 KB an entry.
export const LISTED_STABLE = 10;
const TRACK_RANK = { stable: 0, early: 1, preview: 2 };

function versionOrder(a, b) {
  const [x, y] = [a, b].map(v => v.split('-')[0].split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function listed(releases) {
  const out = [];
  const live = releases.filter(release => !release.isDraft && typeof release.tagName === 'string');
  const plain = live.filter(release => /^v\d+\.\d+\.\d+$/.test(release.tagName) && isRelease(release.tagName.slice(1)));
  const stable = plain.filter(release => !release.isPrerelease)
    .sort((a, b) => versionOrder(b.tagName.slice(1), a.tagName.slice(1))).slice(0, LISTED_STABLE);
  for (const release of stable) out.push({ track: 'stable', tag: release.tagName, date: release.publishedAt });
  const newestStable = stable[0]?.tagName.slice(1) ?? '0.0.0';
  const early = plain.filter(release => release.isPrerelease)
    .sort((a, b) => versionOrder(b.tagName.slice(1), a.tagName.slice(1)))[0];
  if (early && versionOrder(early.tagName.slice(1), newestStable) > 0) out.push({ track: 'early', tag: early.tagName, date: early.publishedAt });
  // The one Preview, while the release it leads to is not out.
  const preview = live.find(release => /^v\d+\.\d+\.\d+-preview$/.test(release.tagName));
  if (preview && versionOrder(preview.tagName.slice(1, -'-preview'.length), newestStable) > 0) {
    out.push({ track: 'preview', tag: preview.tagName, date: preview.publishedAt });
  }
  return out;
}

export function listEntry(track, tag, date, sums) {
  if (!(track in TRACK_RANK)) throw new Error('Say which track: stable, early or preview.');
  if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) throw new Error(`${date} is not a date.`);
  const version = track === 'preview' ? previewVersion(sums) : tag.replace(/^v/, '');
  if (track !== 'preview' && tag !== `v${version}`) throw new Error(`${tag} is not a release tag.`);
  return { ...feedEntry(version, sums, tag), track, date: new Date(date).toISOString() };
}

// Newest first.
export function withListed(feed, entry) {
  const base = feed && feed.format === FEED_FORMAT ? feed : { format: FEED_FORMAT, version: 1, stable: null, early: null };
  const releases = [...(base.releases ?? []).filter(other => other.version !== entry.version), entry]
    .sort((a, b) => versionOrder(b.version, a.version) || TRACK_RANK[a.track] - TRACK_RANK[b.track]);
  return { ...base, releases };
}

// Which version each track names (#94), worked out from the published
// releases each time, so the feed holds no state of its own and is never
// edited by hand: Stable is the release GitHub marks Latest; Early is the
// newest release of either kind, so it is Stable when nothing newer is out.
// Drafts, Previews and anything not tagged vMAJOR.MINOR.PATCH are not
// releases. A track with none is null.
export function tracks(releases) {
  const published = releases
    .filter(release => !release.isDraft && /^v\d+\.\d+\.\d+$/.test(release.tagName) && isRelease(release.tagName.slice(1)))
    .map(release => ({ ...release, version: release.tagName.slice(1) }));
  const newer = (a, b) => {
    const [x, y] = [a, b].map(v => v.version.split('.').map(Number));
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
    return a;
  };
  const latest = published.find(release => release.isLatest && !release.isPrerelease);
  const early = published.reduce((best, release) => (best ? newer(best, release) : release), undefined);
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
      console.error('Usage: node scripts/release.mjs prepare | check | notes [version] | next <major|minor|patch> | tracks <releases.json> | feed <track> <version> <sums> <feed> | listed <releases.json> | list <track> <tag> <date> <sums> <feed>');
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
