// SPDX-License-Identifier: GPL-3.0-only
// The updater acts on the switch and the track as they are when it acts, not
// as they were when it started to check (#57).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: true, getName: () => 'QSO Graph Desktop', relaunch: () => undefined, quit: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined }
}));

const { startUpdater } = await import('../packages/main/updater.js');

const sum = 'a'.repeat(64);
const feedBytes = new TextEncoder().encode(JSON.stringify({
  format: 'qso-graph-desktop-updates', version: 1, stable: null,
  early: { version: '0.2.0', files: { 'linux-x86_64': {
    name: 'qso-graph-desktop-0.2.0-linux-x86_64.AppImage',
    url: 'https://github.com/qso-graph/qso-graph-desktop/releases/download/v0.2.0/qso-graph-desktop-0.2.0-linux-x86_64.AppImage', sha256: sum
  } } }
}));

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; });

function updater(settings: { updateCheck: boolean; updateTrack: 'stable' | 'early' }, network = { online: true }) {
  let release: (bytes: Uint8Array) => void = () => undefined;
  const feed = vi.fn(() => new Promise<Uint8Array>(resolve => { release = resolve; }));
  const download = vi.fn(() => Promise.resolve('The update could not be reached.'));
  const states: string[] = [];
  const started = startUpdater({
    version: '0.1.2', platform: 'linux-x86_64', asks: true, build: 'release',
    // A fresh copy each time, as load() reads settings.json each time.
    settings: () => ({ ...settings }), online: () => network.online, feed, download,
    updatesDirectory: '/nonexistent/updates', openRelease: () => undefined,
    window: () => ({ isDestroyed: () => false, webContents: { send: (_channel: string, state: { kind: string }) => states.push(state.kind) } }) as never
  });
  stop = started.stop;
  return { started, feed, download, states, release: (bytes: Uint8Array) => release(bytes) };
}

describe('the updater acts on the settings as they are now (#57)', () => {
  it('turned off while the feed is on its way: nothing is downloaded', async () => {
    const settings = { updateCheck: true, updateTrack: 'early' as const };
    const { started, download, states, release } = updater(settings);
    const checking = started.check('asked');
    settings.updateCheck = false;
    release(feedBytes);
    await checking;
    expect(download).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('off');
  });

  it('switched to Stable while the feed is on its way: an Early release is not downloaded', async () => {
    const settings: { updateCheck: boolean; updateTrack: 'stable' | 'early' } = { updateCheck: true, updateTrack: 'early' };
    const { started, download, states, release } = updater(settings);
    const checking = started.check('asked');
    settings.updateTrack = 'stable';
    release(feedBytes);
    await checking;
    expect(download).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('current');
  });

  it('left as they were, an Early release is downloaded', async () => {
    const { started, download, release } = updater({ updateCheck: true, updateTrack: 'early' });
    const checking = started.check('asked');
    release(feedBytes);
    await checking;
    expect(download).toHaveBeenCalledOnce();
  });

  it('switched back on while offline: no longer off, and nothing asked (#57, Turing)', async () => {
    const settings = { updateCheck: false, updateTrack: 'early' as const };
    const network = { online: false };
    const { started, feed, states } = updater(settings, network);
    await started.check('asked');
    expect(states.at(-1)).toBe('off');
    settings.updateCheck = true;
    await started.check('asked');
    expect(feed).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('idle');
  });
});

// A Windows install (#81): the installer is kept only when it is signed by
// the publisher that signed the running copy.
describe('a Windows update must be signed like this copy (#81)', () => {
  const name = 'qso-graph-desktop-0.2.0-win-x64.exe';
  const winFeed = new TextEncoder().encode(JSON.stringify({
    format: 'qso-graph-desktop-updates', version: 1, stable: null,
    early: { version: '0.2.0', files: { 'win-x64': {
      name, url: `https://github.com/qso-graph/qso-graph-desktop/releases/download/v0.2.0/${name}`, sha256: sum
    } } }
  }));
  let folder: string;
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  function windowsUpdater(trusted: boolean) {
    folder = mkdtempSync(join(tmpdir(), 'qgd-upd-'));
    const updates = join(folder, 'updates');
    const states: { kind: string; reason?: string }[] = [];
    const asked: string[] = [];
    const started = startUpdater({
      version: '0.1.3', platform: 'win-x64', asks: true, build: 'release',
      settings: () => ({ updateCheck: true, updateTrack: 'early' }), online: () => true,
      feed: () => Promise.resolve(winFeed),
      download: () => {
        mkdirSync(updates, { recursive: true });
        writeFileSync(join(updates, name), 'MZ');
        return Promise.resolve({ path: join(updates, name) });
      },
      updatesDirectory: updates, openRelease: () => undefined,
      windowsTrusted: path => { asked.push(path); return trusted; },
      window: () => ({ isDestroyed: () => false, webContents: { send: (_c: string, state: { kind: string; reason?: string }) => states.push(state) } }) as never
    });
    stop = started.stop;
    return { started, states, asked, updates };
  }

  it('signed by the same publisher: kept, and ready', async () => {
    const { started, states, asked, updates } = windowsUpdater(true);
    await started.check('asked');
    expect(asked).toEqual([join(updates, name)]);
    expect(states.at(-1)?.kind).toBe('ready');
  });

  it('signed by anyone else, or not at all: removed, and the operator told', async () => {
    const { started, states, updates } = windowsUpdater(false);
    await started.check('asked');
    expect(states.at(-1)).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/not signed by the same publisher/) });
    expect(existsSync(join(updates, name))).toBe(false);
  });
});
