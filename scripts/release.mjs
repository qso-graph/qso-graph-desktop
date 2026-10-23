// SPDX-License-Identifier: GPL-3.0-only
// The release steps that are text, not builds (docs/RELEASES.md).
//
//   node scripts/release.mjs prepare            develop, before the release PR:
//                                               [Unreleased] becomes this version
//                                               and today's date, under a new
//                                               empty [Unreleased]
//   node scripts/release.mjs check              CI on main: the version is a plain
//                                               release and CHANGELOG has its section
//   node scripts/release.mjs notes <version>    that section, the release's notes
//   node scripts/release.mjs next <minor|patch|major>
//                                               develop, after a release: the next
//                                               version in package.json and its lock
//   node scripts/release.mjs feed <early|stable> <version> <SHA256SUMS.txt> <desktop.json>
//                                               the update feed's entry for a track,
//                                               from what the release published, in
//                                               the updates repository's file
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
  if (body === undefined) return `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section: run "node scripts/release.mjs prepare" on develop first.`;
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
const SELF_UPDATING = { 'win-x64': 'win-x64.exe', 'linux-x86_64': 'linux-x86_64.AppImage', 'linux-arm64': 'linux-arm64.AppImage' };

export function feedEntry(version, sums) {
  if (!isRelease(version)) throw new Error(`${version} is not a release version (MAJOR.MINOR.PATCH).`);
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
    files[platform] = { name, url: `${RELEASE_DOWNLOADS}/v${version}/${name}`, sha256 };
  }
  return { version, files };
}

export function withEntry(feed, track, entry) {
  if (track !== 'stable' && track !== 'early') throw new Error('Say which track: stable or early.');
  const base = feed && feed.format === FEED_FORMAT ? feed : { format: FEED_FORMAT, version: 1, stable: null, early: null };
  return { ...base, [track]: entry };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main([command, argument]) {
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
      const pkg = readJson('package.json');
      pkg.version = to;
      writeJson('package.json', pkg);
      const lock = readJson('package-lock.json');
      lock.version = to;
      lock.packages[''].version = to;
      writeJson('package-lock.json', lock);
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
      console.error('Usage: node scripts/release.mjs prepare | check | notes [version] | next <major|minor|patch> | feed <track> <version> <sums> <feed>');
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
