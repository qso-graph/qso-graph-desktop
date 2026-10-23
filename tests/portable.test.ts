// SPDX-License-Identifier: GPL-3.0-only
// Portable mode (KI7MT, 2026-10-23): a qso-graph-data folder beside the
// application holds everything it keeps but logins.
import { describe, expect, it } from 'vitest';
import { applicationFolder, portableFolder, PORTABLE_FOLDER } from '../packages/main/portable.js';

const linux = { platform: 'linux', execPath: '/tmp/.mount_qgd123/qg-desktop', env: { APPIMAGE: '/media/ki7mt/STICK/qso-graph-desktop-0.1.0-linux-x86_64.AppImage' } };

describe('where the application is', () => {
  it('is the AppImage\'s own folder on Linux, not the mount it runs from', () => {
    expect(applicationFolder(linux)).toBe('/media/ki7mt/STICK');
  });
  it('is the folder an unpacked zip is in, on Linux and on Windows', () => {
    expect(applicationFolder({ platform: 'linux', execPath: '/home/ki7mt/qgd/qg-desktop', env: {} })).toBe('/home/ki7mt/qgd');
    expect(applicationFolder({ platform: 'win32', execPath: 'E:\\qgd\\QSO Graph Desktop.exe', env: {} })).toBe('E:\\qgd');
    expect(portableFolder({ platform: 'win32', execPath: 'E:\\qgd\\QSO Graph Desktop.exe', env: {}, packaged: true, argv: ['--portable'], exists: () => false })?.folder).toBe('E:\\qgd\\qso-graph-data');
  });
  it('is the folder a .app sits in on macOS', () => {
    expect(applicationFolder({ platform: 'darwin', execPath: '/Volumes/STICK/QSO Graph Desktop.app/Contents/MacOS/QSO Graph Desktop', env: {} }))
      .toBe('/Volumes/STICK');
  });
});

describe('portable mode', () => {
  const run = (over: Partial<Parameters<typeof portableFolder>[0]> = {}) =>
    portableFolder({ ...linux, packaged: true, argv: [], exists: () => false, ...over });

  it('runs from a qso-graph-data folder beside the application, logs and all', () => {
    expect(run({ exists: path => path === `/media/ki7mt/STICK/${PORTABLE_FOLDER}` })).toEqual({
      folder: '/media/ki7mt/STICK/qso-graph-data', logs: '/media/ki7mt/STICK/qso-graph-data/logs', create: false
    });
  });
  it('makes the folder when started with --portable', () => {
    expect(run({ argv: ['qg-desktop', '--portable'] })).toMatchObject({ folder: '/media/ki7mt/STICK/qso-graph-data', create: true });
  });
  it('uses the platform\'s own places otherwise, and in a development run', () => {
    expect(run()).toBeUndefined();
    expect(run({ packaged: false, exists: () => true })).toBeUndefined();
    expect(run({ env: { ...linux.env, QG_DESKTOP_USER_DATA_DIR: '/tmp/x' }, exists: () => true })).toBeUndefined();
  });
});
