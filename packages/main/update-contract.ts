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
export interface Feed { stable: FeedEntry | null; early: FeedEntry | null }

export const FEED_FORMAT = 'qso-graph-desktop-updates';

const RELEASE = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && RELEASE.test(value);
}

// Negative when a is older than b. Release versions only: the feed offers
// nothing else, and a build that is not one never asks.
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(version => version.split('.').map(Number));
  for (let at = 0; at < 3; at++) if (x[at] !== y[at]) return x[at] - y[at];
  return 0;
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

function readEntry(value: unknown): FeedEntry | null {
  if (!record(value) || !only(value, ['version', 'files']) || !isReleaseVersion(value.version) || !record(value.files)) return null;
  const files: Partial<Record<UpdatePlatform, FeedFile>> = {};
  for (const platform of SELF_UPDATING) {
    if (!Object.hasOwn(value.files, platform)) continue;
    const file = readFile(value.files[platform], value.version, platform);
    if (file) files[platform] = file;
  }
  return { version: value.version, files };
}

// The feed's bytes, checked, or undefined. A track the feed cannot say
// properly is read as having nothing to offer, never as something near it.
export function readFeed(bytes: Uint8Array): Feed | undefined {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return undefined; }
  if (!record(value) || value.format !== FEED_FORMAT || value.version !== 1) return undefined;
  return { stable: readEntry(value.stable), early: readEntry(value.early) };
}

// What a build is offered: the newest its track allows, and only if it is
// newer than what is running. Early is offered a full release too when that
// is the newer.
export function choose(feed: Feed, track: UpdateTrack, running: string): FeedEntry | null {
  const candidates = [feed.stable, track === 'early' ? feed.early : null]
    .filter((entry): entry is FeedEntry => entry !== null);
  const newest = candidates.sort((a, b) => compareVersions(b.version, a.version))[0];
  return newest && compareVersions(newest.version, running) > 0 ? newest : null;
}

export type UpdateState =
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
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }            // downloaded and checked; applies on restart or quit
  | { kind: 'failed'; reason: string; checkedAt: number };

export type UpdateCommand =
  | { type: 'state' }
  | { type: 'check' }        // now, whatever the day's check said
  | { type: 'install' }      // download and check the offered version, then wait for restart or quit
  | { type: 'restart' }      // apply a ready update
  | { type: 'release' };     // open the newer version's page in the browser

export function validateUpdateCommand(value: unknown): value is UpdateCommand {
  return record(value) && Object.keys(value).length === 1
    && (value.type === 'state' || value.type === 'check' || value.type === 'install' || value.type === 'restart' || value.type === 'release');
}

const KINDS = ['off', 'idle', 'checking', 'current', 'available', 'downloading', 'ready', 'failed'];
export function isUpdateState(value: unknown): value is UpdateState {
  if (!record(value) || typeof value.kind !== 'string' || !KINDS.includes(value.kind)) return false;
  if ('version' in value && !isReleaseVersion(value.version)) return false;
  if ('reason' in value && (typeof value.reason !== 'string' || value.reason.length > 200)) return false;
  if ('checkedAt' in value && typeof value.checkedAt !== 'number') return false;
  if (value.kind === 'off' && !['switch', 'development', 'preview', 'store'].includes(value.why as string)) return false;
  if (value.kind === 'available' && typeof value.installable !== 'boolean') return false;
  return true;
}
