// SPDX-License-Identifier: GPL-3.0-only
// The release in one line, for Home's welcome (KI7MT, 2026-10-22). Written
// per release, in plain words for the operator; What's new has the rest,
// from CHANGELOG.md (QGD-FRM-0016).
export const HIGHLIGHT = 'Parks On the Air near you, even offline; the sun, the moon and the grey line; and your logins kept in your computer\'s own store.';

// The window's title, with the version (KI7MT, 2026-10-24): "QSO Graph
// Desktop v0.1.0". A Beta by its own version, "v0.6.0-beta.1" (#157). A Daily
// and a lab build, whose versions name their time and commit and are too long
// for a title bar, by the release they lead to and what they are: "v0.6.0
// Daily", "v0.6.0 lab build" (KI7MT, 2026-11-02: the title said "preview" for
// all of them). A pull request's validation build keeps its whole version
// (#92), short enough and the point of it: "v0.2.1-pr96.c0b8250" says which
// build is being tested.
//
// While a newer Release is out (QGD-FRM-0021, #77): "QSO Graph Desktop v0.1.2
// — Update available: v0.2.1". Only a Release, never a Beta or a Daily,
// whatever the track.
export function windowTitle(version: string, stable?: string): string {
  const name = versionName(version);
  const title = name ? `QSO Graph Desktop ${name}` : 'QSO Graph Desktop';
  return stable && /^\d+\.\d+\.\d+$/.test(stable) ? `${title} — Update available: v${stable}` : title;
}

// A version as the screens name it: "v0.6.0", "v0.6.0-beta.1", "v0.6.0
// Daily", "v0.6.0 lab build", or "v0.2.1-pr96.c0b8250" (a Beta's too:
// "v0.6.0-beta.1-pr166.020a55c").
export function versionName(version: string): string {
  if (/^\d+\.\d+\.\d+$/.test(version) || /^\d+\.\d+\.\d+-beta\.[1-9]\d{0,2}$/.test(version)) return `v${version}`;
  if (/^\d+\.\d+\.\d+-pr\d+\.[0-9a-z]+$/.test(version) || /^\d+\.\d+\.\d+-beta\.[1-9]\d{0,2}-pr\d+\.[0-9a-z]+$/.test(version)) return `v${version}`;
  const release = version.split('-')[0];
  if (!/^\d+\.\d+\.\d+$/.test(release)) return '';
  if (/^\d+\.\d+\.\d+-\d{12}-[0-9a-f]{11}$/.test(version)) return `v${release} Daily`;
  if (version.includes('-local.')) return `v${release} lab build`;
  return `v${release}`;
}
