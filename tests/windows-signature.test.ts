// SPDX-License-Identifier: GPL-3.0-only
// An update's Windows installer runs only when it is signed by the same
// publisher as the running copy (#81). The rules on every platform; a real
// signature read where there is Windows to ask.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSigner, samePublisher, signatureEnvironment, windowsSigner } from '../packages/main/windows-signature.js';

const ME = { status: 'Valid', subject: 'CN=Gregory Beam, O=Gregory Beam, L=Boise, S=Idaho, C=US' };

describe('the publisher an update must have (#81)', () => {
  it('runs an installer validly signed by exactly the same subject', () => {
    expect(samePublisher(ME, { ...ME })).toBe(true);
  });

  it('refuses one signed by anyone else, or not validly, or not at all', () => {
    expect(samePublisher(ME, { status: 'Valid', subject: 'CN=Someone Else, O=Someone Else, C=US' })).toBe(false);
    expect(samePublisher(ME, { status: 'Valid', subject: 'CN=Gregory Beam, O=Gregory Beam, C=CA' })).toBe(false);
    expect(samePublisher(ME, { status: 'HashMismatch', subject: ME.subject })).toBe(false);
    expect(samePublisher(ME, { status: 'NotSigned', subject: '' })).toBe(false);
    expect(samePublisher(ME, null)).toBe(false);
  });

  it('trusts nothing when the running copy is not validly signed, as macOS', () => {
    expect(samePublisher({ status: 'NotSigned', subject: '' }, { status: 'NotSigned', subject: '' })).toBe(false);
    expect(samePublisher(null, ME)).toBe(false);
  });

  it('reads Windows\' answer by its shape, and nothing else', () => {
    expect(parseSigner('{"status":"Valid","subject":"CN=Gregory Beam"}\r\n')).toEqual({ status: 'Valid', subject: 'CN=Gregory Beam' });
    expect(parseSigner('')).toBeNull();
    expect(parseSigner('Get-AuthenticodeSignature : not found')).toBeNull();
    expect(parseSigner('[{"status":"Valid","subject":"x"}]')).toBeNull();
    expect(parseSigner('{"status":0,"subject":"x"}')).toBeNull();
    // What CI's Windows runner answered when the wrong module loaded (#85).
    expect(parseSigner('{"status":"","subject":""}')).toBeNull();
  });

  it('starts Windows PowerShell without PowerShell 7\'s module path, whatever its case (#85)', () => {
    const env = signatureEnvironment('C:\\x.exe', { PATH: 'p', PSModulePath: 'C:\\pwsh7', psmodulepath: 'y' });
    expect(env).toEqual({ PATH: 'p', QG_SIGNED_FILE: 'C:\\x.exe' });
  });
});

describe.runIf(process.platform === 'win32')('Windows\' own signature check (#81)', () => {
  it('finds Windows PowerShell signed by Microsoft, and a file we wrote not signed', () => {
    const shell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const signed = windowsSigner(shell);
    expect(signed?.status).toBe('Valid');
    expect(signed?.subject).toMatch(/O=Microsoft Corporation/);
    const folder = mkdtempSync(join(tmpdir(), 'qgd-sig-'));
    try {
      // A name a path could not hide in: the file is passed by environment.
      const plain = join(folder, "it's $(unsigned); & so.exe");
      writeFileSync(plain, 'MZ not a real program');
      expect(windowsSigner(plain)?.status).not.toBe('Valid');
      expect(samePublisher(signed, windowsSigner(plain))).toBe(false);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
