// SPDX-License-Identifier: GPL-3.0-only
// QGD-CRD-0003: the credential core owns its OS credential-store entry names
// and sets them explicitly. This is the test that requirement needed and did
// not have.
//
// The constant said `adif-mcp` — the MCP servers' Keychain namespace — from P0
// until 2026-10-09, long after KI7MT ended Python and MCP interoperability
// (QGD-CRD-0004). The requirement said one thing, the code said another, and
// nothing compared them, so the desktop read and wrote the MCP servers' own
// credentials: two real callsigns' entries sat in the
// namespace the suites were writing synthetic fixtures into, seventeen of
// which were still there. Either product could have overwritten the other's
// entry for the same callsign and provider.
//
// A requirement whose Verify column says Test needs a test that fails when the
// code disagrees with it. This one fails three ways: on the name, on the name
// appearing anywhere in the product again, and on a suite forgetting to put
// its fixtures somewhere safe.
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOREIGN_SERVICE, KEYCHAIN_SERVICE, KEYCHAIN_TEST_SERVICE, TEST_KEYCHAIN_ENV
} from '../scripts/keychain-service.mjs';

// Derived by walking, not listed: a scope that is a list somebody has to
// remember to extend goes quiet, which has happened five times in this project
// (QGD-SEC-0021).
async function sources(root, extensions) {
  const found = [];
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name === 'target' || entry.name === 'node_modules')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      // Forward slashes on every platform, so the names compare with the ones
      // written below.
      else if (extensions.some(end => entry.name.endsWith(end))) found.push(path.split(sep).join('/'));
    }
  };
  await walk(root);
  return found.sort();
}

describe('the credential core owns its namespace', () => {
  it('names a service that is plainly this product’s, and not another’s', () => {
    expect(KEYCHAIN_SERVICE).toBe('io.qso-graph.desktop');
    expect(KEYCHAIN_TEST_SERVICE).toBe('io.qso-graph.desktop.test');
    for (const name of [KEYCHAIN_SERVICE, KEYCHAIN_TEST_SERVICE]) {
      expect(name, 'the core must not use the MCP servers’ namespace').not.toBe(FOREIGN_SERVICE);
      expect(name.startsWith('io.qso-graph.desktop')).toBe(true);
    }
    // Fixtures must not share a service with real credentials, or a sweep
    // scoped by service could reach one.
    expect(KEYCHAIN_SERVICE).not.toBe(KEYCHAIN_TEST_SERVICE);
  });

  it('holds no reference to another product’s namespace anywhere in the product', async () => {
    const files = await sources('packages', ['.rs', '.ts', '.cts', '.svelte']);
    // Not vacuous: the walk has to be finding the core.
    expect(files.some(file => file.endsWith('callsign-core/src/lib.rs'))).toBe(true);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      // The Rust test module names it on purpose, to assert it is not used.
      const code = file.endsWith('lib.rs')
        ? text.slice(0, text.indexOf('mod tests {') === -1 ? text.length : text.indexOf('mod tests {'))
        : text;
      const live = code.split('\n')
        .filter(line => !line.trimStart().startsWith('//'))
        .join('\n');
      expect(live, `${file} names ${FOREIGN_SERVICE}`).not.toContain(FOREIGN_SERVICE);
    }
  });

  it('asks the platform where its own data goes, and names no other product’s directory', async () => {
    // The third instance of the drift, found while fixing the first two: the
    // profile directory was `~/.config/adif-mcp`, so callsigns.json — holding
    // real callsigns — was a file both products wrote.
    //
    // The first fix moved it to `~/.config/qso-graph-desktop`, which stopped
    // the sharing and was still wrong: a Linux convention on macOS, and not
    // where the rest of this application keeps its data. The rule asserted
    // here is the correction — ask the platform.
    const broker = await readFile('packages/main/callsign-broker.ts', 'utf8');
    const live = broker.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
    expect(live, 'the profile directory must come from the platform').toContain("app.getPath('userData')");
    expect(live, `the broker names ${FOREIGN_SERVICE}`).not.toContain(FOREIGN_SERVICE);
    // Not a path of its own choosing anywhere: no XDG, no dot-config, no home.
    for (const invented of ['.config', 'XDG_CONFIG_HOME', 'homedir()']) {
      expect(live, `the broker builds a path from ${invented} instead of asking the platform`)
        .not.toContain(invented);
    }
  });

  it('builds no path from the home directory except where that is the platform’s answer', async () => {
    // As far as a static check reaches: nothing in the product
    // invents a location in the user's home. The exceptions are named, with
    // the reason, because an exception a rule works out for itself is not an
    // exception, it is a hole (the same shape as NETWORK_EXCEPTIONS).
    const allowed = {
      'packages/logging/logger.ts':
        'the log folder is per platform by definition — Library/Logs on macOS, LOCALAPPDATA on Windows, XDG_STATE_HOME on Linux (QGD-LOG-0002)'
    };
    const files = await sources('packages', ['.ts', '.cts', '.svelte']);
    const offenders = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const live = text.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
      if (/\bhomedir\b/.test(live) && !(file in allowed)) offenders.push(file);
    }
    expect(offenders, 'these build a path in the user’s home without a stated reason').toEqual([]);
    // Not vacuous: every named exception still has to be real, or the list is
    // describing a product that has moved on.
    for (const [file, why] of Object.entries(allowed)) {
      const text = await readFile(file, 'utf8');
      expect(/\bhomedir\b/.test(text), `${file} no longer uses homedir — remove it from the list (${why})`).toBe(true);
    }
  });

  it('every suite that reaches the core sends its fixtures somewhere safe', async () => {
    // Derived: any script that loads the addon or drives the application's
    // credential surface must enable the test service first. Forgetting is
    // what put seventeen fixtures in a real login keychain.
    const scripts = await sources('scripts', ['.mjs']);
    const touching = [];
    for (const file of scripts) {
      const text = await readFile(file, 'utf8');
      // Instantiating the core, or driving the credential surface — not
      // merely naming the addon file. scripts/build-native.mjs copies
      // callsign.node and never opens it, and flagging it would have made this
      // check noise somebody switches off.
      if (/CallsignCore|Save in Keychain|save-credentials/.test(text)) touching.push({ file, text });
    }
    // Not vacuous.
    expect(touching.length).toBeGreaterThan(4);
    for (const { file, text } of touching) {
      expect(text, `${file} reaches the credential core without enabling the test service`)
        .toContain('enableTestKeychain()');
      // And before the addon is required, because the service name is read
      // when an entry is made.
      const enable = text.indexOf('enableTestKeychain()');
      const load = text.indexOf('CallsignCore');
      if (load !== -1) {
        expect(enable, `${file} loads the core before enabling the test service`).toBeLessThan(load);
      }
    }
  });

  it('selects the test service by presence, never by a name from outside', async () => {
    // A variable that supplied the service name would be a route back to
    // `adif-mcp`, or to any other product's namespace, from outside the
    // process — which would make every check above worthless.
    const core = await readFile('packages/callsign-core/src/lib.rs', 'utf8');
    const selector = core.split('\n').find(line => line.includes(TEST_KEYCHAIN_ENV) && !line.trimStart().startsWith('//'));
    expect(selector, 'the test-mode selector must exist').toBeTruthy();
    expect(selector).toContain('var_os');
    expect(selector).not.toContain('unwrap_or');
  });
});
