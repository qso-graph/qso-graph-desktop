// SPDX-License-Identifier: GPL-3.0-only
// Who signed a Windows file, asked of Windows itself (#81). An update is run
// only when its installer is validly signed by the same publisher as the copy
// of QSO Graph Desktop that is running, as macOS requires the same team
// (updater.ts). The comparison is pure, so it is tested on every platform;
// reading a signature is Windows' own Get-AuthenticodeSignature.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export interface WindowsSigner {
  // Windows' verdict: 'Valid', 'NotSigned', 'HashMismatch', 'NotTrusted', …
  readonly status: string;
  // The signing certificate's subject, as "CN=Gregory Beam, O=Gregory Beam, …".
  readonly subject: string;
}

// Get-AuthenticodeSignature's answer, written as one line of JSON. The file
// is named by an environment variable, never inside the command, so a path
// cannot become PowerShell.
const SCRIPT = [
  '$s = Get-AuthenticodeSignature -LiteralPath $env:QG_SIGNED_FILE',
  '[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress'
].join('; ');

// The JSON above, checked for its shape; anything else is no answer.
export function parseSigner(output: string): WindowsSigner | null {
  let value: unknown;
  try { value = JSON.parse(output.trim()); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { status, subject } = value as Record<string, unknown>;
  if (typeof status !== 'string' || typeof subject !== 'string') return null;
  return { status, subject };
}

// An installer the running copy may run: both validly signed, by exactly the
// same subject. An unsigned running copy trusts nothing, as on macOS.
export function samePublisher(running: WindowsSigner | null, update: WindowsSigner | null): boolean {
  if (!running || !update) return false;
  if (running.status !== 'Valid' || update.status !== 'Valid') return false;
  return running.subject !== '' && running.subject === update.subject;
}

// Windows PowerShell at its fixed place under the Windows folder; no shell.
function powershell(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function windowsSigner(file: string): WindowsSigner | null {
  const read = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, QG_SIGNED_FILE: file }
  });
  if (read.status !== 0 || typeof read.stdout !== 'string') return null;
  return parseSigner(read.stdout);
}

// The check the updater makes, before it keeps a download and again before
// it runs it: signed by whoever signed this running copy.
export function signedLikeThisCopy(installer: string): boolean {
  return samePublisher(windowsSigner(process.execPath), windowsSigner(installer));
}
