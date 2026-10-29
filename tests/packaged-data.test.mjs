// SPDX-License-Identifier: GPL-3.0-only
// Every register main reads from the application's own directory ships in
// the package. build.files is an allowlist, so a register read and not
// listed is a file an installed application does not have: Integrations'
// limits were that (Codex review, 2026-10-29), and an adapter turned on in an
// installed copy would never have opened its port. Derived from main's own
// source, so a register added later is held to it too.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const READ = /join\(app\.getAppPath\(\), 'data', '([^']+)'\)/g;

export function readRegisters(source) {
  return [...source.matchAll(READ)].map(match => `data/${match[1]}`);
}

describe('the registers main reads ship in the package', () => {
  it('lists every one in build.files', async () => {
    const read = readRegisters(await readFile('packages/main/main.ts', 'utf8'));
    // Not vacuous: main reads several, Integrations' limits among them.
    expect(read).toContain('data/integration-limits.json');
    const files = JSON.parse(await readFile('package.json', 'utf8')).build.files;
    for (const register of read) expect(files, register).toContain(register);
  });

  it('would notice one read and not listed', () => {
    expect(readRegisters("x(join(app.getAppPath(), 'data', 'new-register.json'));")).toEqual(['data/new-register.json']);
  });
});
