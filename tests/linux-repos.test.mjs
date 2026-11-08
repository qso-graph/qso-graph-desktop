// SPDX-License-Identifier: GPL-3.0-or-later
// The Linux package and command are named what a user sees on every download (#145). The apt and dnf
// repositories that serve them are built in qso-graph/qso-graph-packages, with their own tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the Linux package (#145)', () => {
  it('names the Linux package and command what a user sees on every download (#145)', () => {
    // Until 0.5.1 the package was qg-desktop, the project's internal name, while
    // every file, the site and the repository said qso-graph-desktop, so
    // `dnf upgrade qso-graph-desktop` answered "No match for argument".
    const build = JSON.parse(readFileSync('package.json', 'utf8')).build;
    const shown = /^([a-z-]+)-\$\{version\}/.exec(build.artifactName)[1];
    expect(shown).toBe('qso-graph-desktop');
    expect(build.rpm.packageName).toBe(shown);
    expect(build.deb.packageName).toBe(shown);
    expect(build.linux.executableName).toBe(shown);
    // An installation under the old name moves on its next upgrade.
    expect(build.rpm.fpm.join(' ')).toContain('--replaces qg-desktop <= 0.5.1 --provides qg-desktop');
    expect(build.deb.fpm.join(' ')).toContain('--replaces qg-desktop (<= 0.5.1) --deb-field Breaks: qg-desktop (<= 0.5.1)');
  });
});
