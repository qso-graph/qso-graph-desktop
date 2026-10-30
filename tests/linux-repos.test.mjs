// SPDX-License-Identifier: GPL-3.0-only
// dnf's index names the bytes packages.qso-graph.net serves (#143). Each run
// signed every rpm again; a signature carries its time, so the file kept its
// size and changed its bytes, the upload (which never rewrites a package) kept
// the old one, and dnf refused it: "checksum doesn't match". The script needs
// rpm, createrepo_c and apt-ftparchive, which the unit suite's machines lack,
// so this holds the two halves of the fix in place; the Packages run's own
// "Served as built" step is what proves each release.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const commands = file => readFileSync(file, 'utf8').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

describe("dnf's index and the served packages (#143)", () => {
  it('keeps a served rpm that is this release, signed with the release key, instead of signing it again', () => {
    const script = commands('scripts/linux-repos.sh');
    expect(script).toContain('Kept as served');
    expect(script).toContain("%{SHA256HEADER} %{PAYLOADDIGEST}");
    expect(script).toMatch(/--checksig "\$dest".*digests signatures OK/);
  });

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
    expect(commands('scripts/linux-repos.sh')).toContain('Depends: qso-graph-desktop (>= $newest)');
  });

  it('checks every served file against what was built, packages too', () => {
    const step = commands('.github/workflows/packages.yml').split('- name: Served as built')[1];
    expect(step).toBeDefined();
    // Asking only that a package exists is what passed while every .rpm was wrong.
    expect(step).not.toMatch(/curl -fsSI/);
    expect(step).not.toMatch(/\*\.deb\|\*\.rpm/);
    expect(step).toContain('is not what was built');
  });
});
