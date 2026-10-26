// SPDX-License-Identifier: GPL-3.0-only
// The profile kept before an install and put back when going back (#77,
// QGD-FRM-0020): what is kept, what is not, and how many.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KEEP_STABLE, snapshots } from '../packages/main/snapshots.js';

let folder = '';
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }); folder = ''; });

function profile() {
  folder = mkdtempSync(join(tmpdir(), 'qgd-snap-'));
  const root = join(folder, 'profile');
  const callsigns = join(root, 'callsigns');
  mkdirSync(join(callsigns, 'updates'), { recursive: true });
  mkdirSync(join(root, 'extensions', 'pota'), { recursive: true });
  writeFileSync(join(root, 'settings.json'), '{}');
  writeFileSync(join(root, 'state.sqlite'), 'state');
  writeFileSync(join(root, 'reference.sqlite'), 'public, rebuilt');
  writeFileSync(join(root, 'extensions', 'pota', 'data.json'), 'pota');
  writeFileSync(join(callsigns, 'KI7MT.json'), 'KI7MT');
  writeFileSync(join(callsigns, 'updates', 'qso-graph-desktop-0.2.1-linux-x86_64.AppImage'), 'big');
  return { root, callsigns, kept: snapshots({ root, callsigns }) };
}

describe('snapshots (#77)', () => {
  it('keeps settings, the state store, the extensions\' data and the callsign files, and nothing else', () => {
    const { root, kept } = profile();
    expect(kept.take('0.2.1')).toBe(true);
    const at = join(root, 'snapshots', '0.2.1');
    expect(readFileSync(join(at, 'state.sqlite'), 'utf8')).toBe('state');
    expect(readFileSync(join(at, 'extensions', 'pota', 'data.json'), 'utf8')).toBe('pota');
    expect(readFileSync(join(at, 'callsigns', 'KI7MT.json'), 'utf8')).toBe('KI7MT');
    expect(existsSync(join(at, 'reference.sqlite'))).toBe(false);
    expect(existsSync(join(at, 'callsigns', 'updates'))).toBe(false);
  });

  it('never follows or copies a link', () => {
    const { root, callsigns, kept } = profile();
    writeFileSync(join(folder, 'outside.txt'), 'not ours');
    symlinkSync(join(folder, 'outside.txt'), join(callsigns, 'link.json'));
    expect(kept.take('0.2.1')).toBe(true);
    expect(existsSync(join(root, 'snapshots', '0.2.1', 'callsigns', 'link.json'))).toBe(false);
  });

  it('puts back what was kept, and leaves the downloaded update alone', () => {
    const { root, callsigns, kept } = profile();
    kept.take('0.2.1');
    writeFileSync(join(root, 'state.sqlite'), 'newer');
    writeFileSync(join(root, 'state.sqlite-shm'), 'newer');
    writeFileSync(join(callsigns, 'W1AW.json'), 'added later');
    expect(kept.restore('0.2.1')).toBe(true);
    expect(readFileSync(join(root, 'state.sqlite'), 'utf8')).toBe('state');
    expect(existsSync(join(root, 'state.sqlite-shm'))).toBe(false);
    expect(existsSync(join(callsigns, 'W1AW.json'))).toBe(false);
    expect(existsSync(join(callsigns, 'updates', 'qso-graph-desktop-0.2.1-linux-x86_64.AppImage'))).toBe(true);
  });

  it('refuses a name that is not a version, and one it does not hold', () => {
    const { kept } = profile();
    expect(kept.take('../x')).toBe(false);
    expect(kept.restore('0.1.0')).toBe(false);
  });

  it(`keeps the last ${KEEP_STABLE} Stable versions left, and the newest of anything else`, () => {
    const { kept } = profile();
    for (const version of ['0.1.0', '0.2.0', '0.2.1', '0.3.0-202610260100-0123456789a', '0.3.0-202610270100-0123456789b', '0.2.2']) kept.take(version);
    expect(kept.list().sort()).toEqual(['0.2.0', '0.2.1', '0.2.2', '0.3.0-202610270100-0123456789b']);
  });
});
