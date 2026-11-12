// SPDX-License-Identifier: GPL-3.0-or-later
// Whether a change is documentation only (#95), so CI runs the citation check
// alone and builds nothing. The changed files come one per line on standard
// input, a renamed file by its old name as well as its new one (moving code
// into docs/ is not documentation; found in review, #92). Prints true or false.
//
// The spec, its handbook and the RVM generated from it are documentation: the
// application does not ship them (package-contents.mjs), and the citations job
// checks the spec and the RVM. No files at all is not
// documentation only: a run that could not read them builds everything.
//
// CHANGELOG.md ships as What's New, so it counts only when asked for
// (--changelog). A pull request asks: every change adds a line to it, and a
// line there should not cost an hour of builds. Two things keep What's New
// right: a release candidate always builds (ci.yml's plan), and Release asks
// without it, so a build is never published as current once CHANGELOG.md has
// changed after it.
import { readFileSync } from 'node:fs';

const DOCUMENTATION = /^(README\.md|CONTRIBUTING\.md|SECURITY\.md|PRIVACY\.md|AGENTS\.md|CLAUDE\.md|\.github\/pull_request_template\.md|guide\/.+|docs\/.+|spec\/.+|hdbk\/.+|rvm\/.+)$/;

export function documentationOnly(files, { changelog = false } = {}) {
  const names = files.map(name => name.trim()).filter(Boolean);
  return names.length > 0 && names.every(name => DOCUMENTATION.test(name) || (changelog && name === 'CHANGELOG.md'));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const changelog = process.argv.slice(2).includes('--changelog');
  console.log(String(documentationOnly(readFileSync(0, 'utf8').split('\n'), { changelog })));
}
