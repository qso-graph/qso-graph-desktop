// SPDX-License-Identifier: GPL-3.0-only
// Updates (QGD-FRM-0019, docs/RELEASES.md): what the feed may say, which
// update a build takes from it, and what the window is told. Pure, so the
// choice runs under unit tests; packages/main/updater.ts does the asking,
// the downloading and the installing.
import { UPDATE_FILE_NAME } from '../callsigns/callsign-contract.js';
import type { UpdateTrack } from './settings-contract.js';

export const UPDATES_CHANNEL = 'updates:request';
export const UPDATES_STATE_CHANNEL = 'updates:state';

// The builds that install an update themselves, by the feed's key for them.
// Everything else is told a newer version exists and where to get it.
export const SELF_UPDATING = ['win-x64', 'linux-x86_64', 'linux-arm64', 'mac-arm64'] as const;
export type UpdatePlatform = typeof SELF_UPDATING[number];
// The file each platform installs, as a release names it: the feed's entry
// for a platform must be that platform's own file (#57: a Linux entry naming
// a Windows installer was accepted, and would have replaced the AppImage).
const PLATFORM_FILE: Record<UpdatePlatform, string> = {
  'win-x64': '-win-x64.exe',
  'linux-x86_64': '-linux-x86_64.AppImage',
  'linux-arm64': '-linux-arm64.AppImage',
  'mac-arm64': '-mac-arm64.zip'
};

export interface FeedFile { name: string; url: string; sha256: string }
export interface FeedEntry { version: string; files: Partial<Record<UpdatePlatform, FeedFile>> }
// One version the feed lists (#77), for Choose a version…: its track and the
// date it was published, besides its files.
export type ListedTrack = 'stable' | 'early' | 'preview';
export interface ListedEntry extends FeedEntry { track: ListedTrack; date: string }
export interface Feed { stable: FeedEntry | null; early: FeedEntry | null; releases: ListedEntry[] }

export const FEED_FORMAT = 'qso-graph-desktop-updates';

const RELEASE = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && RELEASE.test(value);
}

// A Preview's version: the release it leads to, the commit's UTC date and
// time, and the commit (ci.yml, "Preview version").
const PREVIEW = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})-(\d{12})-[0-9a-f]{11}$/;
export function isPreviewVersion(value: unknown): value is string {
  return typeof value === 'string' && PREVIEW.test(value);
}
// A version the feed may offer: a release, or a Preview (#77).
export function isOfferedVersion(value: unknown): value is string {
  return isReleaseVersion(value) || isPreviewVersion(value);
}

// Negative when a is older than b. A Preview comes before the release it
// leads to, and after any other Preview of it built earlier.
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(version => version.split('-')[0].split('.').map(Number));
  for (let at = 0; at < 3; at++) if (x[at] !== y[at]) return x[at] - y[at];
  const [p, q] = [a, b].map(version => PREVIEW.exec(version)?.[4]);
  if (p === q) return 0;
  if (p === undefined) return 1;
  if (q === undefined) return -1;
  return p < q ? -1 : 1;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function readFile(value: unknown, version: string, platform: UpdatePlatform): FeedFile | undefined {
  if (!record(value) || !only(value, ['name', 'url', 'sha256'])) return undefined;
  const { name, url, sha256 } = value;
  if (typeof name !== 'string' || !UPDATE_FILE_NAME.test(name) || name !== `qso-graph-desktop-${version}${PLATFORM_FILE[platform]}`) return undefined;
  if (typeof url !== 'string' || url.length > 2048 || !url.startsWith('https://')) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.port) return undefined;
  } catch { return undefined; }
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  return { name, url, sha256 };
}

function readEntry(value: unknown, listed = false): FeedEntry | null {
  if (!record(value) || !only(value, listed ? ['version', 'files', 'track', 'date'] : ['version', 'files']) || !record(value.files)) return null;
  const version = value.version;
  if (typeof version !== 'string' || !(listed ? isOfferedVersion(version) : isReleaseVersion(version))) return null;
  const files: Partial<Record<UpdatePlatform, FeedFile>> = {};
  for (const platform of SELF_UPDATING) {
    if (!Object.hasOwn(value.files, platform)) continue;
    const file = readFile(value.files[platform], version, platform);
    if (file) files[platform] = file;
  }
  return { version, files };
}

// The most the list may hold: ten Stable releases, the newest Early and the
// Preview (scripts/release.mjs), with room to spare.
export const MAX_LISTED = 24;

function readListed(value: unknown): ListedEntry | null {
  if (!record(value)) return null;
  const { track, date } = value;
  if (track !== 'stable' && track !== 'early' && track !== 'preview') return null;
  if (typeof date !== 'string' || date.length > 40 || Number.isNaN(Date.parse(date))) return null;
  // A track that says what the version is: a Preview's version is a Preview's.
  if ((track === 'preview') !== isPreviewVersion(value.version)) return null;
  const entry = readEntry(value, true);
  return entry ? { ...entry, track, date } : null;
}

// The feed's bytes, checked, or undefined. A track the feed cannot say
// properly is read as having nothing to offer, never as something near it.
export function readFeed(bytes: Uint8Array): Feed | undefined {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return undefined; }
  if (!record(value) || value.format !== FEED_FORMAT || value.version !== 1) return undefined;
  // The list is 0.3.0's (#77): a feed without one offers only the tracks. An
  // entry it cannot read is left out, never read as something near it.
  const releases = Array.isArray(value.releases) && value.releases.length <= MAX_LISTED
    ? value.releases.map(readListed).filter((entry): entry is ListedEntry => entry !== null)
    : [];
  return { stable: readEntry(value.stable), early: readEntry(value.early), releases };
}

// What a build is offered: the newest its track allows, and only if it is
// newer than what is running. Early is offered a full release too when that
// is the newer.
export function choose(feed: Feed, track: UpdateTrack, running: string): FeedEntry | null {
  const preview = track === 'preview' ? feed.releases.find(entry => entry.track === 'preview') ?? null : null;
  const candidates = [feed.stable, track !== 'stable' ? feed.early : null, preview]
    .filter((entry): entry is FeedEntry => entry !== null);
  const newest = candidates.sort((a, b) => compareVersions(b.version, a.version))[0];
  return newest && compareVersions(newest.version, running) > 0 ? newest : null;
}

// What Choose a version… lists (#77, QGD-FRM-0020): forward, what the track
// allows; back, Stable releases only (KI7MT, 2026-10-26). `snapshot`: going
// back to it puts back the data kept when it was left.
export interface VersionChoice {
  version: string;
  track: ListedTrack;
  date: string;
  way: 'running' | 'forward' | 'back';
  snapshot: boolean;
}

export function versionChoices(feed: Feed, track: UpdateTrack, running: string, snapshots: readonly string[]): VersionChoice[] {
  const allowed: ListedTrack[] = track === 'stable' ? ['stable'] : track === 'early' ? ['stable', 'early'] : ['stable', 'early', 'preview'];
  const out: VersionChoice[] = [];
  for (const entry of feed.releases) {
    const order = compareVersions(entry.version, running);
    const way = order === 0 ? 'running' : order > 0 ? 'forward' : 'back';
    if (way === 'forward' && !allowed.includes(entry.track)) continue;
    if (way === 'back' && entry.track !== 'stable') continue;
    out.push({ version: entry.version, track: entry.track, date: entry.date, way, snapshot: way === 'back' && snapshots.includes(entry.version) });
  }
  return out;
}

// Every state may carry `stable`: a Stable release newer than the one
// running, for the window's title (QGD-FRM-0021), whatever the track.
export type UpdateState = { stable?: string } & (
  // Not checking, and why: the switch is off, or this is a development
  // build or a preview, which never check (KI7MT, 2026-10-24: say which).
  // 'store': installed from the Microsoft Store, which updates it (KI7MT,
  // 2026-10-24); its own updater never runs there.
  | { kind: 'off'; why: 'switch' | 'development' | 'preview' | 'store' }
  | { kind: 'idle' }                              // not asked yet this session
  | { kind: 'checking' }
  | { kind: 'current'; checkedAt: number }        // nothing newer
  // Newer. installable: this build can download and install it, and does so only when the operator
  // chooses (KI7MT, 2026-10-24: Check only checks); otherwise What's new links to it.
  | { kind: 'available'; version: string; checkedAt: number; installable: boolean }
  // back: an older version (#77), whose install puts back the data kept when it was left.
  | { kind: 'downloading'; version: string; back?: boolean }
  | { kind: 'ready'; version: string; back?: boolean } // downloaded and checked; applies on restart or quit
  | { kind: 'failed'; reason: string; checkedAt: number });

export type UpdateCommand =
  | { type: 'state' }
  | { type: 'check' }        // now, whatever the day's check said
  | { type: 'install' }      // download and check the offered version, then wait for restart or quit
  | { type: 'install'; version: string } // one chosen from the list (#77): forward or back
  | { type: 'versions' }     // the list Choose a version… shows, from the last check
  | { type: 'restart' }      // apply a ready update
  | { type: 'release' };     // open the newer version's page in the browser

export function validateUpdateCommand(value: unknown): value is UpdateCommand {
  if (!record(value)) return false;
  if (value.type === 'install' && Object.hasOwn(value, 'version')) return only(value, ['type', 'version']) && isOfferedVersion(value.version);
  return Object.keys(value).length === 1
    && (value.type === 'state' || value.type === 'check' || value.type === 'install' || value.type === 'versions' || value.type === 'restart' || value.type === 'release');
}

function isVersionChoice(value: unknown): value is VersionChoice {
  return record(value) && only(value, ['version', 'track', 'date', 'way', 'snapshot'])
    && isOfferedVersion(value.version)
    && (value.track === 'stable' || value.track === 'early' || value.track === 'preview')
    && typeof value.date === 'string' && value.date.length <= 40
    && (value.way === 'running' || value.way === 'forward' || value.way === 'back')
    && typeof value.snapshot === 'boolean';
}
export function isVersionChoices(value: unknown): value is VersionChoice[] {
  return Array.isArray(value) && value.length <= MAX_LISTED && value.every(isVersionChoice);
}

const KINDS = ['off', 'idle', 'checking', 'current', 'available', 'downloading', 'ready', 'failed'];
export function isUpdateState(value: unknown): value is UpdateState {
  if (!record(value) || typeof value.kind !== 'string' || !KINDS.includes(value.kind)) return false;
  if ('version' in value && !isOfferedVersion(value.version)) return false;
  if ('back' in value && typeof value.back !== 'boolean') return false;
  if ('stable' in value && !isReleaseVersion(value.stable)) return false;
  if ('reason' in value && (typeof value.reason !== 'string' || value.reason.length > 200)) return false;
  if ('checkedAt' in value && typeof value.checkedAt !== 'number') return false;
  if (value.kind === 'off' && !['switch', 'development', 'preview', 'store'].includes(value.why as string)) return false;
  if (value.kind === 'available' && typeof value.installable !== 'boolean') return false;
  return true;
}
