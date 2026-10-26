// SPDX-License-Identifier: GPL-3.0-only
// The release in one line, for Home's welcome (KI7MT, 2026-10-22). Written
// per release, in plain words for the operator; What's new has the rest,
// from CHANGELOG.md (QGD-FRM-0016).
export const HIGHLIGHT = 'Parks On the Air near you, even offline; the sun, the moon and the grey line; and your logins kept in your computer\'s own store.';

// The window's title, with the version (KI7MT, 2026-10-24): "QSO Graph
// Desktop v0.1.0", or for a preview, whose version names its commit and is
// too long for a title bar, the release it leads to: "v0.1.1 preview". A
// pull request's validation build keeps its whole version (#92), short
// enough and the point of it: "v0.2.1-pr96.c0b8250" says which build is being
// tested.
//
// While a newer Stable release is out (QGD-FRM-0021, #77): "QSO Graph
// Desktop v0.1.2 — Update available: v0.2.1". Only a Stable release, never a
// pre-release or a Preview, whatever the track.
export function windowTitle(version: string, stable?: string): string {
  const name = versionName(version);
  const title = name ? `QSO Graph Desktop ${name}` : 'QSO Graph Desktop';
  return stable && /^\d+\.\d+\.\d+$/.test(stable) ? `${title} — Update available: v${stable}` : title;
}

// A version as the screens name it: "v0.1.0", "v0.1.1 preview", or
// "v0.2.1-pr96.c0b8250".
export function versionName(version: string): string {
  if (/^\d+\.\d+\.\d+-pr\d+\.[0-9a-z]+$/.test(version)) return `v${version}`;
  const [release, ...rest] = version.split('-');
  return /^\d+\.\d+\.\d+$/.test(release) ? `v${release}${rest.length > 0 ? ' preview' : ''}` : '';
}
