// SPDX-License-Identifier: GPL-3.0-only
// Whether a change is documentation only (#95), so CI runs the citation check
// alone and builds nothing. The changed files come one per line on standard
// input, a renamed file by its old name as well as its new one (moving code
// into docs/ is not documentation; found by Codex, #92). Prints true or false.
//
// Not on the list, on purpose: the spec (CI checks the RVM generated from it)
// and CHANGELOG.md (it ships as What's New). No files at all is not
// documentation only: a run that could not read them builds everything.
import { readFileSync } from 'node:fs';

const DOCUMENTATION = /^(README\.md|CONTRIBUTING\.md|SECURITY\.md|PRIVACY\.md|AGENTS\.md|CLAUDE\.md|\.github\/pull_request_template\.md|guide\/.+|docs\/.+)$/;

export function documentationOnly(files) {
  const names = files.map(name => name.trim()).filter(Boolean);
  return names.length > 0 && names.every(name => DOCUMENTATION.test(name));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  console.log(String(documentationOnly(readFileSync(0, 'utf8').split('\n'))));
}
