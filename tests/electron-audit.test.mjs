// SPDX-License-Identifier: GPL-3.0-only
// The Electron audit (#42, #158) catches what it is for: each mistake planted
// in this project's own code, as main.ts and index.html have it, is refused.
// The packaged run is the electron-audit suite; this holds its rules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FuseV1Options } from '@electron/fuses';
import { auditCsp, auditFuses, auditMain } from '../scripts/electron-audit.mjs';

// main.ts's own text stands in for the compiled main.js: tsc keeps these lines.
const main = readFileSync('packages/main/main.ts', 'utf8');
const html = readFileSync('packages/renderer/index.html', 'utf8');
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
    expect(auditMain(main, main)).toEqual([]);
    expect(auditCsp(html)).toEqual([]);
    expect(auditFuses(wireFrom(configured), configured)).toEqual([]);
  });

  it('refuses a window setting undone or missing', () => {
    for (const [from, to] of [['contextIsolation: true', 'contextIsolation: false'], ['sandbox: true', 'sandbox: false'],
      ['nodeIntegration: false', 'nodeIntegration: true'], ['webviewTag: false', 'webviewTag: true'],
      ['webSecurity: true', 'webSecurity: false'], ['allowRunningInsecureContent: false', 'allowRunningInsecureContent: true']]) {
      const planted = main.replace(from, to);
      expect(planted, from).not.toBe(main);
      expect(auditMain(planted, planted).length, `${from} → ${to}`).toBeGreaterThan(0);
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
      expect(auditMain(planted, planted).length, planted.slice(-80)).toBeGreaterThan(0);
    }
    // The setting may be undone in any packaged script, not only main.js.
    expect(auditMain(main, `${main}\n({ webPreferences: { nodeIntegration: true } })`).length).toBeGreaterThan(0);
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
