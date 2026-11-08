// SPDX-License-Identifier: GPL-3.0-or-later
// QGD-SEC-0014: the packaged application's Electron security, checked by this
// project rather than by Electronegativity (#42, #158). Electronegativity's last
// release was in 2021, and it brought in eslint 7 and the oldest minimatch and
// glob (Dependabot #28). These are the rules of .claude/rules/typescript-
// security.md, held to what was packaged:
//
//   1. The fuses, read from the packaged binary with @electron/fuses, each the
//      value package.json's electronFuses gives it. Electronegativity never
//      read fuses.
//   2. The one window, from the packaged main process: every webPreferences
//      setting the rules require; the handlers that refuse a new window, a
//      navigation, a <webview> and every permission; no BrowserView or
//      WebContentsView; and, anywhere in the packaged code, no setting that
//      would undo one of them.
//   3. The Chromium switches main sets: exactly the reviewed list, each of
//      which turns something off.
//   4. The renderer's Content-Security-Policy, from the packaged index.html:
//      nothing unsafe, nothing remote, and scripts from 'self' only.
//
// What Electron applies at run time is packaged-launch's: it reads the live
// window's webPreferences and tries window.open and a navigation (#158).
//
// Read out of app.asar, never the working tree: what was packaged is what ships.
import asar from '@electron/asar';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Where electron-builder leaves the unpacked application, and its binary.
const PRODUCT = 'QSO Graph Desktop';
const BUILDS = [
  { archive: `out/mac-arm64/${PRODUCT}.app/Contents/Resources/app.asar`, binary: archive => join(dirname(dirname(archive)), 'MacOS', PRODUCT) },
  { archive: `out/mac/${PRODUCT}.app/Contents/Resources/app.asar`, binary: archive => join(dirname(dirname(archive)), 'MacOS', PRODUCT) },
  { archive: 'out/linux-unpacked/resources/app.asar', binary: archive => join(dirname(dirname(archive)), 'qso-graph-desktop') },
  { archive: 'out/linux-arm64-unpacked/resources/app.asar', binary: archive => join(dirname(dirname(archive)), 'qso-graph-desktop') },
  { archive: 'out/win-unpacked/resources/app.asar', binary: archive => join(dirname(dirname(archive)), `${PRODUCT}.exe`) },
  { archive: 'out/win-arm64-unpacked/resources/app.asar', binary: archive => join(dirname(dirname(archive)), `${PRODUCT}.exe`) }
];

// package.json's electronFuses key, by the fuse it sets. resetAdHocDarwinSignature
// is electron-builder's, not a fuse.
const FUSE_FOR = {
  runAsNode: FuseV1Options.RunAsNode,
  enableCookieEncryption: FuseV1Options.EnableCookieEncryption,
  enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
  enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
  loadBrowserProcessSpecificV8Snapshot: FuseV1Options.LoadBrowserProcessSpecificV8Snapshot,
  grantFileProtocolExtraPrivileges: FuseV1Options.GrantFileProtocolExtraPrivileges
};
// The fuses the rules require, whatever package.json says: RunAsNode off, ASAR
// integrity on, Node's CLI options off (typescript-security.md, Electron).
const REQUIRED_FUSES = { runAsNode: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
  enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false };
const ON = '1'.charCodeAt(0);
const OFF = '0'.charCodeAt(0);

// The one window's webPreferences, as the compiler writes them.
const REQUIRED_PREFERENCES = [
  'sandbox: true', 'contextIsolation: true', 'nodeIntegration: false', 'nodeIntegrationInWorker: false',
  'nodeIntegrationInSubFrames: false', 'webviewTag: false', 'webSecurity: true', 'allowRunningInsecureContent: false'
];
// Each refuses something; together they are the rules' "deny new windows, block
// navigation" and no permission granted.
const REQUIRED_HANDLERS = [
  [/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/, 'new windows are refused (setWindowOpenHandler → deny)'],
  [/\.on\('will-navigate', (\w+) => \1\.preventDefault\(\)\)/, 'navigation is refused (will-navigate → preventDefault)'],
  [/\.on\('will-attach-webview', (\w+) => \1\.preventDefault\(\)\)/, 'a <webview> is refused (will-attach-webview → preventDefault)'],
  [/setPermissionRequestHandler\(\([^)]*\) => (\w+)\(false\)\)/, 'every permission request is refused (setPermissionRequestHandler → false)']
];
// Anywhere in the packaged code: a setting that would undo one of the above.
const FORBIDDEN = [
  [/\bnodeIntegration(InWorker|InSubFrames)?\s*:\s*true/, 'Node in a renderer'],
  [/\bcontextIsolation\s*:\s*false/, 'contextIsolation off'],
  [/\bsandbox\s*:\s*false/, 'the sandbox off'],
  [/\bwebSecurity\s*:\s*false/, 'webSecurity off'],
  [/\ballowRunningInsecureContent\s*:\s*true/, 'insecure content allowed'],
  [/\bexperimentalFeatures\s*:\s*true/, 'experimental features on'],
  [/\benableBlinkFeatures\b/, 'Blink features enabled'],
  [/\bwebviewTag\s*:\s*true/, '<webview> enabled'],
  [/\benableRemoteModule\b/, 'the remote module'],
  [/\bnew (BrowserView|WebContentsView)\(/, 'a second view'],
  [/\bsetPermissionCheckHandler\([^)]*\) => true/, 'every permission check granted'],
  [/\bdisable-web-security\b|\bno-sandbox\b|\ballow-running-insecure-content\b|\bremote-debugging-port\b/, 'a switch that removes a protection']
];
// The switches main sets, exactly; each turns something off (QGD-SEC-0020: the
// application reaches nothing it was not asked to).
const SWITCHES = [
  "appendSwitch('disable-background-networking')",
  "appendSwitch('disable-component-update')",
  "appendSwitch('disable-domain-reliability')",
  "appendSwitch('disable-sync')",
  "appendSwitch('no-pings')",
  "appendSwitch('disable-features', 'MediaRouter,OptimizationHints,AutofillServerCommunication')"
];

// The CSP's own words: nothing that loosens it. Remote sources are any scheme
// or host, and a wildcard.
const UNSAFE_SOURCE = /'unsafe-|'wasm-unsafe-eval'|\bhttps?:|\bws(s)?:|\bdata:|\bblob:|\bfilesystem:|(^|\s)\*(\s|$)/;

export function auditFuses(wire, configured) {
  const problems = [];
  for (const [key, value] of Object.entries(configured)) {
    const fuse = FUSE_FOR[key];
    if (fuse === undefined) continue;
    const got = wire[fuse];
    if (got !== (value ? ON : OFF)) problems.push(`fuse ${FuseV1Options[fuse]} is ${got === ON ? 'on' : got === OFF ? 'off' : `unset (${got})`}, and package.json says ${value ? 'on' : 'off'}`);
  }
  for (const [key, value] of Object.entries(REQUIRED_FUSES)) {
    if (configured[key] !== value) problems.push(`package.json's electronFuses must set ${key} to ${value}`);
  }
  return problems;
}

export function auditMain(main, everything) {
  const problems = [];
  const windows = (everything.match(/\bnew BrowserWindow\(/g) ?? []).length;
  if (windows !== 1) problems.push(`${windows} BrowserWindow constructions in the packaged code, where there is one window`);
  for (const preference of REQUIRED_PREFERENCES) if (!main.includes(preference)) problems.push(`the window does not set ${preference}`);
  for (const [pattern, what] of REQUIRED_HANDLERS) if (!pattern.test(main)) problems.push(`not found: ${what}`);
  for (const [pattern, what] of FORBIDDEN) {
    const found = pattern.exec(everything);
    if (found) problems.push(`${what}: "${found[0]}"`);
  }
  const switches = (main.match(/appendSwitch\([^)]*\)/g) ?? []);
  for (const found of switches) if (!SWITCHES.includes(found)) problems.push(`a switch not reviewed: ${found}`);
  for (const reviewed of SWITCHES) if (!switches.includes(reviewed)) problems.push(`a reviewed switch is gone: ${reviewed} (remove it from the list)`);
  if (/appendArgument\(/.test(main)) problems.push('an argument appended to Chromium, not reviewed');
  return problems;
}

export function auditCsp(html) {
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  if (!meta) return ['index.html has no Content-Security-Policy'];
  const problems = [];
  const directives = new Map(meta[1].split(';').map(part => part.trim()).filter(Boolean)
    .map(part => { const [name, ...sources] = part.split(/\s+/); return [name.toLowerCase(), sources.join(' ')]; }));
  if (directives.get('default-src') !== "'none'") problems.push(`default-src is "${directives.get('default-src') ?? 'missing'}", not 'none'`);
  if (directives.get('script-src') !== "'self'") problems.push(`script-src is "${directives.get('script-src') ?? 'missing'}", not 'self'`);
  for (const name of ['object-src', 'base-uri', 'frame-ancestors', 'form-action']) {
    if (directives.get(name) !== "'none'") problems.push(`${name} is "${directives.get(name) ?? 'missing'}", not 'none'`);
  }
  for (const [name, sources] of directives) if (UNSAFE_SOURCE.test(sources)) problems.push(`${name} allows "${sources}"`);
  return problems;
}

async function main() {
  const failures = [];
  const build = BUILDS.find(candidate => existsSync(candidate.archive));
  if (!build) { console.error('Electron audit failed.\n  No packaged application. Run: make package'); process.exitCode = 1; return; }
  const archive = resolve(build.archive);
  const binary = build.binary(archive);

  const configured = JSON.parse(await readFile('package.json', 'utf8')).build.electronFuses ?? {};
  if (!existsSync(binary)) failures.push(`No packaged binary at ${binary}.`);
  else failures.push(...auditFuses(await getCurrentFuseWire(binary), configured));

  const files = asar.listPackage(archive, { isPack: false }).map(path => path.replace(/^[/\\]/, '').replaceAll('\\', '/'));
  const read = path => asar.extractFile(archive, path).toString('utf8');
  const js = files.filter(path => path.startsWith('dist/') && /\.(c|m)?js$/.test(path));
  if (!files.includes('dist/main/main.js')) failures.push('No dist/main/main.js in the archive.');
  else failures.push(...auditMain(read('dist/main/main.js'), js.map(read).join('\n')));
  if (!files.includes('dist/renderer/index.html')) failures.push('No dist/renderer/index.html in the archive.');
  else failures.push(...auditCsp(read('dist/renderer/index.html')));

  if (failures.length) {
    console.error('Electron audit failed.');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Electron audit: ${build.archive}: fuses as configured, one window with every required setting and refusal, the reviewed switches only, a strict CSP, and nothing that undoes them in ${js.length} packaged scripts: PASS`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
