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
    default:
      console.error('Usage: node scripts/release.mjs prepare | check | notes [version] | next <major|minor|patch>');
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
