// SPDX-License-Identifier: GPL-3.0-only
// Microsoft's Visual C++ runtime on Windows (#91): missing is said, present
// is silent, and other platforms never ask.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_MESSAGE, windowsRuntimeMissing } from '../packages/main/windows-runtime-contract.js';
import { validateLinkRegister } from '../packages/main/links-contract.js';
import { readFileSync } from 'node:fs';

describe("Microsoft's Visual C++ runtime (#91)", () => {
  const root = 'C:\\Windows';
  const dll = join(root, 'System32', 'vcruntime140.dll');

  it('is missing on Windows when the system folder has no vcruntime140.dll', () => {
    expect(windowsRuntimeMissing('win32', root, false, () => false)).toBe(true);
  });

  it('is there when the system folder has it, and is looked for there alone', () => {
    const asked: string[] = [];
    expect(windowsRuntimeMissing('win32', root, false, path => { asked.push(path); return path === dll; })).toBe(false);
    expect(asked).toEqual([dll]);
  });

  it('is never asked about on macOS or Linux', () => {
    expect(windowsRuntimeMissing('darwin', undefined, false, () => false)).toBe(false);
    expect(windowsRuntimeMissing('linux', undefined, false, () => false)).toBe(false);
  });

  it("is never asked about in the Store copy, which Microsoft's package supplies", () => {
    expect(windowsRuntimeMissing('win32', root, true, () => false)).toBe(false);
  });

  it('counts as missing when Windows does not say where it is', () => {
    expect(windowsRuntimeMissing('win32', undefined, false, () => true)).toBe(true);
  });

  it("names the file to choose, and Microsoft's page is in the link register", () => {
    expect(RUNTIME_MESSAGE.detail).toContain('vc_redist.x64.exe');
    const register = validateLinkRegister(JSON.parse(readFileSync('data/links.json', 'utf8')));
    expect(register.sites.vcruntime).toMatch(/^https:\/\/learn\.microsoft\.com\//);
  });
});
