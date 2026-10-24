// SPDX-License-Identifier: GPL-3.0-only
// The release in one line, for Home's welcome (KI7MT, 2026-10-22). Written
// per release, in plain words for the operator; What's new has the rest,
// from CHANGELOG.md (QGD-FRM-0016).
export const HIGHLIGHT = 'Parks On the Air near you, even offline; the sun, the moon and the grey line; and your logins kept in your computer\'s own store.';

// The window's title, with the version (KI7MT, 2026-10-24): "QSO Graph
// Desktop v0.1.0", or for a preview, whose version names its commit and is
// too long for a title bar, the release it leads to: "v0.1.1 preview".
export function windowTitle(version: string): string {
  const [release, ...rest] = version.split('-');
  return /^\d+\.\d+\.\d+$/.test(release)
    ? `QSO Graph Desktop v${release}${rest.length > 0 ? ' preview' : ''}`
    : 'QSO Graph Desktop';
}
