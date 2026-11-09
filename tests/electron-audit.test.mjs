// SPDX-License-Identifier: GPL-3.0-or-later
// The Electron audit (#42, #158) catches what it is for: each mistake planted
// in this project's own code, as main.ts and index.html have it, is refused.
// The packaged run is the electron-audit suite; this holds its rules.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FuseV1Options } from '@electron/fuses';
import { auditCsp, auditFuses, auditMain } from '../scripts/electron-audit.mjs';

// The same scope the packaged audit reads, compiled modules included.
// Keys use '/', as the asar listing does; readdirSync gives '\\' on Windows.
const scripts = new Map(readdirSync('dist', { recursive: true }).filter(path => /\.(c|m)?js$/.test(path))
  .map(path => ['dist/' + path.replaceAll('\\', '/'), readFileSync(join('dist', path), 'utf8')]));
const main = scripts.get('dist/main/main.js');
const html = readFileSync('dist/renderer/index.html', 'utf8');
const audit = (entry = main, extra = '') => auditMain(entry, new Map([...scripts, ['dist/main/main.js', entry], ['planted.js', extra]]));
const configured = JSON.parse(readFileSync('package.json', 'utf8')).build.electronFuses;
const ON = '1'.charCodeAt(0);
const OFF = '0'.charCodeAt(0);
const wireFrom = settings => {
  const map = { runAsNode: 'RunAsNode', enableCookieEncryption: 'EnableCookieEncryption',
    enableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable', enableNodeCliInspectArguments: 'EnableNodeCliInspectArguments',
    enableEmbeddedAsarIntegrityValidation: 'EnableEmbeddedAsarIntegrityValidation', onlyLoadAppFromAsar: 'OnlyLoadAppFromAsar',
    grantFileProtocolExtraPrivileges: 'GrantFileProtocolExtraPrivileges' };
  const wire = { version: '1' };
  for (const [key, value] of Object.entries(settings)) if (map[key]) wire[FuseV1Options[map[key]]] = value ? ON : OFF;
  return wire;
};

describe('the Electron audit (#42, #158)', () => {
  it('passes this project as it is', () => {
    expect(audit()).toEqual([]);
    expect(auditCsp(html)).toEqual([]);
    expect(auditFuses(wireFrom(configured), configured)).toEqual([]);
  });

  it('refuses a window setting undone or missing', () => {
    for (const [from, to] of [['contextIsolation: true', 'contextIsolation: false'], ['sandbox: true', 'sandbox: false'],
      ['nodeIntegration: false', 'nodeIntegration: true'], ['webviewTag: false', 'webviewTag: true'],
      ['webSecurity: true', 'webSecurity: false'], ['allowRunningInsecureContent: false', 'allowRunningInsecureContent: true']]) {
      const planted = main.replace(from, to);
      expect(planted, from).not.toBe(main);
      expect(audit(planted).length, `${from} → ${to}`).toBeGreaterThan(0);
    }
  });

  it('refuses a handler removed, a second window, a view, or a new switch', () => {
    const cases = [
      main.replace("setWindowOpenHandler(() => ({ action: 'deny' }))", "setWindowOpenHandler(() => ({ action: 'allow' }))"),
      main.replace("on('will-navigate', event => event.preventDefault())", "on('will-navigate', () => {})"),
      main.replace("on('will-attach-webview', event => event.preventDefault())", "on('will-attach-webview', () => {})"),
      main.replace('callback(false)', 'callback(true)'),
      `${main}\nconst second = new BrowserWindow({});`,
      `${main}\nconst view = new WebContentsView({});`,
      `${main}\napp.commandLine.appendSwitch('remote-debugging-port', '9222');`,
      `${main}\napp.commandLine.appendSwitch('enable-features', 'Something');`,
      `${main}\nwebContents.session.setPermissionCheckHandler(() => true);`
    ];
    for (const planted of cases) {
      expect(planted).not.toBe(main);
      expect(audit(planted).length, planted.slice(-80)).toBeGreaterThan(0);
    }
    // The setting may be undone in any packaged script, not only main.js.
    expect(audit(main, '({ webPreferences: { nodeIntegration: true } })').length).toBeGreaterThan(0);
  });

  it('refuses a CSP that is loosened', () => {
    for (const [from, to] of [["script-src 'self'", "script-src 'self' 'unsafe-inline'"], ["script-src 'self'", "script-src 'self' 'unsafe-eval'"],
      ["script-src 'self'", "script-src 'self' https://cdn.example.com"], ["connect-src 'none'", 'connect-src *'],
      ["img-src 'none'", 'img-src data:'], ["default-src 'none'", "default-src 'self'"], ["object-src 'none'", "object-src 'self'"]]) {
      const planted = html.replace(from, to);
      expect(planted, from).not.toBe(html);
      expect(auditCsp(planted).length, to).toBeGreaterThan(0);
    }
    expect(auditCsp('<html><head></head></html>')).toEqual(['index.html has no Content-Security-Policy']);
  });

  it('refuses a fuse that differs from package.json, and a package.json that loosens one the rules require', () => {
    expect(auditFuses(wireFrom({ ...configured, runAsNode: true }), configured).length).toBeGreaterThan(0);
    expect(auditFuses(wireFrom({ ...configured, onlyLoadAppFromAsar: false }), configured).length).toBeGreaterThan(0);
    const loosened = { ...configured, enableNodeCliInspectArguments: true };
    expect(auditFuses(wireFrom(loosened), loosened).length).toBeGreaterThan(0);
  });
});

it('audits the actual compiled password window independently of the main window', () => {
  const path = 'dist/main/lotw-dialogs.js';
  const dialog = scripts.get(path);
  expect(dialog).toContain('new BrowserWindow(');
  const planted = dialog.replace('sandbox: true,', '');
  expect(planted).not.toBe(dialog);
  expect(auditMain(main, new Map([...scripts, [path, planted]]))).toContainEqual(expect.stringMatching(/lotw-dialogs.*sandbox/));
});

it.each(['dist/main/main.js', 'dist/main/lotw-dialogs.js'])('holds each protection to its own window in %s', path => {
  const source = scripts.get(path);
  const controls = [
    'sandbox: true,', 'contextIsolation: true,', 'nodeIntegration: false,',
    'nodeIntegrationInWorker: false,', 'nodeIntegrationInSubFrames: false,',
    'webviewTag: false,', 'webSecurity: true,', 'allowRunningInsecureContent: false,',
    "window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));",
    "window.webContents.on('will-navigate', event => event.preventDefault());",
    "window.webContents.on('will-attach-webview', event => event.preventDefault());"
  ];
  for (const control of controls) {
    const planted = source.replace(control, '');
    expect(planted, control).not.toBe(source);
    const changed = new Map([...scripts, [path, planted]]);
    expect(auditMain(changed.get('dist/main/main.js'), changed), control).toContainEqual(expect.stringContaining(path));
  }
  const permission = source.replace(/(callback|answer)\(false\)/, '$1(true)');
  expect(permission).not.toBe(source);
  expect(auditMain(main, new Map([...scripts, [path, permission]]))).toContainEqual(expect.stringContaining(path));
});

it('cannot borrow another window\'s preferences or handlers and fails when no windows are found', () => {
  const extra = `${main}\nfunction extraWindow() { const window = new BrowserWindow({}); }`;
  expect(audit(extra)).toContainEqual(expect.stringContaining('window does not set sandbox'));
  expect(auditMain(main, new Map())).toContain('No BrowserWindow construction in the packaged scripts');
});

it('checks the CSP of the compiled password document', () => {
  const path = 'dist/main/lotw-dialogs.js';
  const source = scripts.get(path);
  for (const [from, to] of [["script-src 'none'", "script-src 'self'"], ['Content-Security-Policy', 'removed-policy']]) {
    const planted = source.replace(from, to);
    expect(planted).not.toBe(source);
    expect(auditMain(main, new Map([...scripts, [path, planted]]))).toContainEqual(expect.stringMatching(/lotw-dialogs.*(script-src|Content-Security-Policy)/));
  }
});
