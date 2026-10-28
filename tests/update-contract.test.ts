// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0019: what the update feed may say, and which update a build takes
// from it. A feed that cannot say a track properly offers nothing on it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { choose, compareVersions, readFeed, validateUpdateCommand, isUpdateState } from '../packages/main/update-contract.js';
import { linkFor, validateLinkCommand, validateLinkRegister } from '../packages/main/links-contract.js';
import { readSettings, validateSettingsCommand } from '../packages/main/settings-contract.js';

const sum = 'a'.repeat(64);
const file = (version: string, tail: string) => ({
  name: `qso-graph-desktop-${version}-${tail}`,
  url: `https://github.com/qso-graph/qso-graph-desktop/releases/download/v${version}/qso-graph-desktop-${version}-${tail}`,
  sha256: sum
});
const entry = (version: string) => ({
  version,
  files: { 'win-x64': file(version, 'win-x64.exe'), 'linux-x86_64': file(version, 'linux-x86_64.AppImage') }
});
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const feed = (stable: unknown, early: unknown) => readFeed(bytes({ format: 'qso-graph-desktop-updates', version: 1, stable, early }));

describe('the update feed', () => {
  it('reads both tracks', () => {
    const read = feed(entry('0.1.1'), entry('0.2.0'));
    expect(read?.stable?.version).toBe('0.1.1');
    expect(read?.early?.files['linux-x86_64']?.name).toBe('qso-graph-desktop-0.2.0-linux-x86_64.AppImage');
  });

  it('refuses a feed that is not one', () => {
    expect(readFeed(bytes({ format: 'other', version: 1 }))).toBeUndefined();
    expect(readFeed(bytes({ format: 'qso-graph-desktop-updates', version: 2 }))).toBeUndefined();
    expect(readFeed(new Uint8Array([0xff, 0xfe]))).toBeUndefined();
    expect(readFeed(bytes('just a string'))).toBeUndefined();
  });

  it('offers nothing on a track it cannot read, never something near it', () => {
    expect(feed({ version: 'v0.1.1', files: {} }, null)?.stable).toBeNull();
    expect(feed({ version: '0.1.1-202610230124-abc', files: {} }, null)?.stable).toBeNull();
    expect(feed({ ...entry('0.1.1'), extra: true }, null)?.stable).toBeNull();
  });

  it('drops a file whose name, address or sum is wrong, and keeps the rest', () => {
    const files = {
      'win-x64': { ...file('0.1.1', 'win-x64.exe'), name: 'qso-graph-desktop-0.1.0-win-x64.exe' },
      'linux-x86_64': { ...file('0.1.1', 'linux-x86_64.AppImage'), url: 'http://github.com/x.AppImage' },
      'linux-arm64': { ...file('0.1.1', 'linux-arm64.AppImage'), sha256: 'A'.repeat(64) }
    };
    expect(feed({ version: '0.1.1', files }, null)?.stable?.files).toEqual({});
    const login = { ...file('0.1.1', 'win-x64.exe'), url: 'https://user:pw@github.com/qso-graph-desktop-0.1.1-win-x64.exe' };
    expect(feed({ version: '0.1.1', files: { 'win-x64': login } }, null)?.stable?.files).toEqual({});
    // Each platform's entry must be that platform's own file (#57).
    const crossed = file('0.1.1', 'win-x64.exe');
    expect(feed({ version: '0.1.1', files: { 'linux-arm64': crossed } }, null)?.stable?.files).toEqual({});
    const zip = file('0.1.1', 'win-x64.zip');
    expect(feed({ version: '0.1.1', files: { 'win-x64': zip } }, null)?.stable?.files).toEqual({});
    // The macOS zip is the one zip that installs itself.
    const mac = file('0.1.1', 'mac-arm64.zip');
    expect(feed({ version: '0.1.1', files: { 'mac-arm64': mac } }, null)?.stable?.files['mac-arm64']?.name).toBe(mac.name);
  });
});

describe('which update a build is offered', () => {
  const both = feed(entry('0.1.1'), entry('0.2.0'))!;

  it('Stable is offered full releases only', () => {
    expect(choose(both, 'stable', '0.1.0')?.version).toBe('0.1.1');
    expect(choose(both, 'stable', '0.1.1')).toBeNull();
  });

  it('Early is offered the newer of the two', () => {
    expect(choose(both, 'early', '0.1.0')?.version).toBe('0.2.0');
    const behind = feed(entry('0.3.0'), entry('0.2.0'))!;
    expect(choose(behind, 'early', '0.1.0')?.version).toBe('0.3.0');
  });

  it('nothing older or the same, and nothing from an empty feed', () => {
    expect(choose(both, 'early', '0.2.0')).toBeNull();
    expect(choose(both, 'early', '1.0.0')).toBeNull();
    expect(choose(feed(null, null)!, 'early', '0.1.0')).toBeNull();
  });

  it('compares versions by number, not by text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('what the window may ask and be told', () => {
  it('accepts its four commands and nothing else', () => {
    for (const type of ['state', 'check', 'restart', 'release']) expect(validateUpdateCommand({ type })).toBe(true);
    expect(validateUpdateCommand({ type: 'download', url: 'https://example.com' })).toBe(false);
    expect(validateUpdateCommand({ type: 'check', now: true })).toBe(false);
  });

  it('a state is checked before it is shown', () => {
    expect(isUpdateState({ kind: 'ready', version: '0.1.1' })).toBe(true);
    expect(isUpdateState({ kind: 'ready', version: '<b>0.1.1</b>' })).toBe(false);
    expect(isUpdateState({ kind: 'installing' })).toBe(false);
    // Not checking says why: the switch, a development build, or a preview.
    expect(isUpdateState({ kind: 'off', why: 'development' })).toBe(true);
    expect(isUpdateState({ kind: 'off', why: 'preview' })).toBe(true);
    // No Store-only state (#86: the Store copy is the same installer and updates itself).
    expect(isUpdateState({ kind: 'off', why: 'store' })).toBe(false);
    expect(isUpdateState({ kind: 'off' })).toBe(false);
    expect(isUpdateState({ kind: 'off', why: 'bored' })).toBe(false);
  });

  it('the switch is on and the track Stable by default, and both are written only as what they are', () => {
    expect(readSettings({})).toMatchObject({ updateCheck: true, updateTrack: 'stable' });
    expect(readSettings({ updateCheck: 'no', updateTrack: 'nightly' })).toMatchObject({ updateCheck: true, updateTrack: 'stable' });
    expect(validateSettingsCommand({ type: 'write', key: 'updateCheck', value: false })).toBe(true);
    expect(validateSettingsCommand({ type: 'write', key: 'updateTrack', value: 'early' })).toBe(true);
    expect(validateSettingsCommand({ type: 'write', key: 'updateTrack', value: 'preview' })).toBe(true);
    expect(validateSettingsCommand({ type: 'write', key: 'updateTrack', value: 'nightly' })).toBe(false);
  });

  it('a newer version\'s page is built from the register, and only main may ask for it', () => {
    const register = validateLinkRegister(JSON.parse(readFileSync('data/links.json', 'utf8')));
    expect(linkFor(register, { type: 'release', version: '0.1.1' }))
      .toBe('https://github.com/qso-graph/qso-graph-desktop/releases/tag/v0.1.1');
    expect(linkFor(register, { type: 'release', version: '0.1.1/../../x' })).toBe('');
    expect(validateLinkCommand({ type: 'release', version: '0.1.1' })).toBe(false);
  });
});
