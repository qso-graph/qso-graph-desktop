// SPDX-License-Identifier: GPL-3.0-only
// The updater acts on the switch and the track as they are when it acts, not
// as they were when it started to check (#57); and checking only checks: the
// download waits for the operator's Download and install (KI7MT, 2026-10-24).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: true, getName: () => 'QSO Graph Desktop', relaunch: () => undefined, quit: () => undefined },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined }
}));

const { startUpdater } = await import('../packages/main/updater.js');
const { snapshots } = await import('../packages/main/snapshots.js');

const sum = 'a'.repeat(64);
const noSnapshots = { take: () => true, restore: () => false, list: () => [] };
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
    updatesDirectory: '/nonexistent/updates', openRelease: () => undefined, snapshots: noSnapshots,
    window: () => ({ isDestroyed: () => false, webContents: { send: (_channel: string, state: { kind: string }) => states.push(state.kind) } }) as never
  });
  stop = started.stop;
  return { started, feed, download, states, release: (bytes: Uint8Array) => release(bytes) };
}

// A check, then the operator's Download and install, which asks the feed again.
async function offered(made: ReturnType<typeof updater>): Promise<void> {
  const checking = made.started.check('asked');
  made.release(feedBytes);
  await checking;
}

describe('checking only checks (KI7MT, 2026-10-24)', () => {
  it('a newer version is offered, and nothing is downloaded until the operator chooses', async () => {
    const made = updater({ updateCheck: true, updateTrack: 'early' });
    await offered(made);
    expect(made.download).not.toHaveBeenCalled();
    expect(made.states.at(-1)).toBe('available');
    expect(made.started.state()).toMatchObject({ kind: 'available', version: '0.2.0', installable: true });
  });

  it('a build that cannot install it is offered the link only', async () => {
    let release: (bytes: Uint8Array) => void = () => undefined;
    const download = vi.fn(() => Promise.resolve('no'));
    const started = startUpdater({
      version: '0.1.2', platform: null, asks: true, build: 'release',
      settings: () => ({ updateCheck: true, updateTrack: 'early' }), online: () => true,
      feed: () => new Promise<Uint8Array>(resolve => { release = resolve; }), download,
      updatesDirectory: '/nonexistent/updates', openRelease: () => undefined, snapshots: noSnapshots,
      window: () => ({ isDestroyed: () => false, webContents: { send: () => undefined } }) as never
    });
    stop = started.stop;
    const checking = started.check('asked');
    release(feedBytes);
    await checking;
    expect(started.state()).toMatchObject({ kind: 'available', installable: false });
    expect(download).not.toHaveBeenCalled();
  });
});

describe('the updater acts on the settings as they are now (#57)', () => {
  it('turned off while the feed is on its way: nothing is downloaded', async () => {
    const settings = { updateCheck: true, updateTrack: 'early' as const };
    const made = updater(settings);
    await offered(made);
    const installing = made.started.check('install');
    settings.updateCheck = false;
    made.release(feedBytes);
    await installing;
    expect(made.download).not.toHaveBeenCalled();
    expect(made.states.at(-1)).toBe('off');
  });

  it('switched to Stable while the feed is on its way: an Early release is not downloaded', async () => {
    const settings: { updateCheck: boolean; updateTrack: 'stable' | 'early' } = { updateCheck: true, updateTrack: 'early' };
    const made = updater(settings);
    await offered(made);
    const installing = made.started.check('install');
    settings.updateTrack = 'stable';
    made.release(feedBytes);
    await installing;
    expect(made.download).not.toHaveBeenCalled();
    expect(made.states.at(-1)).toBe('current');
  });

  it('left as they were, Download and install downloads the Early release', async () => {
    const made = updater({ updateCheck: true, updateTrack: 'early' });
    await offered(made);
    const installing = made.started.check('install');
    made.release(feedBytes);
    await installing;
    expect(made.download).toHaveBeenCalledOnce();
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
      updatesDirectory: updates, openRelease: () => undefined, snapshots: noSnapshots,
      windowsTrusted: path => { asked.push(path); return trusted; },
      window: () => ({ isDestroyed: () => false, webContents: { send: (_c: string, state: { kind: string; reason?: string }) => states.push(state) } }) as never
    });
    stop = started.stop;
    return { started, states, asked, updates };
  }

  it('signed by the same publisher: kept, and ready', async () => {
    const { started, states, asked, updates } = windowsUpdater(true);
    await started.check('asked');
    expect(states.at(-1)?.kind).toBe('available');
    await started.check('install');
    expect(asked).toEqual([join(updates, name)]);
    expect(states.at(-1)?.kind).toBe('ready');
  });

  it('signed by anyone else, or not at all: removed, and the operator told', async () => {
    const { started, states, updates } = windowsUpdater(false);
    await started.check('asked');
    await started.check('install');
    expect(states.at(-1)).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/not signed by the same publisher/) });
    expect(existsSync(join(updates, name))).toBe(false);
  });
});

describe('a copy from the Microsoft Store never updates itself (KI7MT, 2026-10-24)', () => {
  it('says the Store updates it, and asks nothing', async () => {
    const feed = vi.fn(() => Promise.resolve(feedBytes));
    const states: string[] = [];
    const started = startUpdater({
      version: '0.2.0', platform: null, asks: false, build: 'store',
      settings: () => ({ updateCheck: true, updateTrack: 'early' }), online: () => true, feed,
      download: () => Promise.resolve('no'), updatesDirectory: '/nonexistent/updates', openRelease: () => undefined, snapshots: noSnapshots,
      window: () => ({ isDestroyed: () => false, webContents: { send: (_c: string, state: { kind: string; why?: string }) => states.push(`${state.kind}:${state.why ?? ''}`) } }) as never
    });
    stop = started.stop;
    expect(started.state()).toEqual({ kind: 'off', why: 'store' });
    await started.check('asked');
    expect(feed).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('off:store');
  });
});

// Choosing a version (#77, QGD-FRM-0020): forward as the track allows, back to
// Stable only, and going back puts back the data kept when it was left.
describe('choosing a version, and going back (#77)', () => {
  let folder = '';
  const savedAppImage = process.env.APPIMAGE;
  afterEach(() => {
    if (folder) rmSync(folder, { recursive: true, force: true });
    folder = '';
    if (savedAppImage === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = savedAppImage;
  });

  const listed = (version: string, track: string, date: string) => ({
    version, track, date,
    files: { 'linux-x86_64': {
      name: `qso-graph-desktop-${version}-linux-x86_64.AppImage`,
      url: `https://github.com/qso-graph/qso-graph-desktop/releases/download/v${version}/qso-graph-desktop-${version}-linux-x86_64.AppImage`, sha256: sum
    } }
  });
  const listFeed = new TextEncoder().encode(JSON.stringify({
    format: 'qso-graph-desktop-updates', version: 1,
    stable: { version: '0.2.1', files: listed('0.2.1', 'stable', '2026-10-25T22:31:47Z').files },
    early: { version: '0.3.0', files: listed('0.3.0', 'early', '2026-10-27T00:00:00Z').files },
    releases: [
      listed('0.3.0', 'early', '2026-10-27T00:00:00Z'),
      listed('0.2.2', 'stable', '2026-10-26T00:00:00Z'),
      listed('0.2.1', 'stable', '2026-10-25T22:31:47Z'),
      listed('0.2.0', 'early', '2026-10-25T03:33:51Z')
    ]
  }));

  function chooser(running: string, track: 'stable' | 'early' | 'preview' = 'stable') {
    folder = mkdtempSync(join(tmpdir(), 'qgd-back-'));
    const root = join(folder, 'profile');
    const callsigns = join(root, 'callsigns');
    const updates = join(callsigns, 'updates');
    mkdirSync(callsigns, { recursive: true });
    process.env.APPIMAGE = join(folder, 'QSO Graph Desktop.AppImage');
    writeFileSync(process.env.APPIMAGE, 'running');
    const kept = snapshots({ root, callsigns });
    const states: Record<string, unknown>[] = [];
    const started = startUpdater({
      version: running, platform: 'linux-x86_64', asks: true, build: 'release',
      settings: () => ({ updateCheck: true, updateTrack: track }), online: () => true,
      feed: () => Promise.resolve(listFeed),
      download: (_url: string, _sum: string, name: string) => {
        mkdirSync(updates, { recursive: true });
        writeFileSync(join(updates, name), `the AppImage of ${name}`);
        return Promise.resolve({ path: join(updates, name) });
      },
      updatesDirectory: updates, openRelease: () => undefined, snapshots: kept,
      window: () => ({ isDestroyed: () => false, webContents: { send: (_c: string, state: Record<string, unknown>) => states.push(state) } }) as never
    });
    stop = started.stop;
    return { started, states, root, kept };
  }

  it('lists forward what the track allows, and back Stable releases only', async () => {
    const { started } = chooser('0.2.2');
    await started.check('asked');
    expect(started.versions().map(choice => `${choice.version}:${choice.way}`)).toEqual(['0.2.2:running', '0.2.1:back']);
    const early = chooser('0.2.2', 'early');
    await early.started.check('asked');
    expect(early.started.versions().map(choice => `${choice.version}:${choice.way}`)).toEqual(['0.3.0:forward', '0.2.2:running', '0.2.1:back']);
  });

  it('refuses a version the list does not offer: an Early one going back', async () => {
    const { started } = chooser('0.2.2', 'early');
    await started.check('install', '0.2.0');
    expect(started.state()).toMatchObject({ kind: 'failed', reason: 'Version 0.2.0 is not offered now.' });
  });

  it('going back keeps today\'s data, then puts back what was kept when that version was left', async () => {
    const { started, root, kept } = chooser('0.2.2');
    // What 0.2.1 had when it was left, then what 0.2.2 made of it.
    writeFileSync(join(root, 'settings.json'), '{"was":"0.2.1"}');
    writeFileSync(join(root, 'callsigns', 'KI7MT.json'), 'as in 0.2.1');
    expect(kept.take('0.2.1')).toBe(true);
    writeFileSync(join(root, 'settings.json'), '{"was":"0.2.2"}');
    writeFileSync(join(root, 'callsigns', 'KI7MT.json'), 'as in 0.2.2');

    await started.check('asked');
    expect(started.versions().find(choice => choice.version === '0.2.1')).toMatchObject({ way: 'back', snapshot: true });
    await started.check('install', '0.2.1');
    expect(started.state()).toMatchObject({ kind: 'ready', version: '0.2.1', back: true });

    started.applyOnQuit();
    expect(readFileSync(process.env.APPIMAGE!, 'utf8')).toBe('the AppImage of qso-graph-desktop-0.2.1-linux-x86_64.AppImage');
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{"was":"0.2.1"}');
    expect(readFileSync(join(root, 'callsigns', 'KI7MT.json'), 'utf8')).toBe('as in 0.2.1');
    // Today's is kept, so updating again can put it back.
    expect(kept.list().sort()).toEqual(['0.2.1', '0.2.2']);
    expect(readFileSync(join(root, 'snapshots', '0.2.2', 'settings.json'), 'utf8')).toBe('{"was":"0.2.2"}');
  });

  it('nothing is installed when today\'s data cannot be kept', async () => {
    const { started, root } = chooser('0.2.2');
    await started.check('asked');
    await started.check('install', '0.2.1');
    // The snapshots folder is a file: nothing can be kept there.
    writeFileSync(join(root, 'snapshots'), 'in the way');
    started.applyOnQuit();
    expect(readFileSync(process.env.APPIMAGE!, 'utf8')).toBe('running');
  });

  it('every state it sends is one the window accepts, the title\'s Stable included (#77)', async () => {
    const { isUpdateState, isVersionChoices } = await import('../packages/main/update-contract.js');
    const { started, states } = chooser('0.2.0', 'early');
    await started.check('asked');
    await started.check('install', '0.2.1');
    expect(states.length).toBeGreaterThan(2);
    for (const state of states) expect(isUpdateState(state), JSON.stringify(state)).toBe(true);
    expect(states.at(-1)).toMatchObject({ kind: 'ready', stable: '0.2.1', back: false });
    expect(isVersionChoices(started.versions())).toBe(true);
  });
});
