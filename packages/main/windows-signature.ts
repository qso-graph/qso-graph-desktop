// SPDX-License-Identifier: GPL-3.0-only
// Who signed a Windows file, asked of Windows itself (#81). An update is run
// only when its installer is validly signed by the same publisher as the copy
// of QSO Graph Desktop that is running (by us, when that copy is unsigned:
// #121), as macOS requires the same team
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
  // Any error stops it, so a failure is no answer rather than an empty one.
  "$ErrorActionPreference = 'Stop'",
  '$s = Get-AuthenticodeSignature -LiteralPath $env:QG_SIGNED_FILE',
  '[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress'
].join('; ');

// The JSON above, checked for its shape; anything else is no answer.
export function parseSigner(output: string): WindowsSigner | null {
  let value: unknown;
  try { value = JSON.parse(output.trim()); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { status, subject } = value as Record<string, unknown>;
  // An empty status is no answer: Windows always names one.
  if (typeof status !== 'string' || status === '' || typeof subject !== 'string') return null;
  return { status, subject };
}

// Our publisher, as Windows names the certificate that signs every release
// (read from 0.3.1's installer, 2026-10-28).
export const OUR_PUBLISHER = 'CN=Gregory Beam, O=Gregory Beam, L=Boise, S=id, C=US';

// An installer the running copy may run: validly signed, by exactly the
// subject that signed the running copy. A copy that is not validly signed, a
// lab build (#121), has no publisher of its own to compare, so the installer
// must be ours: until then it trusted nothing, and could not go back to a
// release at all.
export function samePublisher(running: WindowsSigner | null, update: WindowsSigner | null): boolean {
  if (!update || update.status !== 'Valid') return false;
  const expected = running && running.status === 'Valid' ? running.subject : OUR_PUBLISHER;
  return expected !== '' && update.subject === expected;
}

// Windows PowerShell at its fixed place under the Windows folder; no shell.
function powershell(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// Windows PowerShell's environment: this process's, without PSModulePath.
// Started from PowerShell 7 (a CI runner, or a ham who has it), that
// variable lists PowerShell 7's modules first, Windows PowerShell loads
// the wrong Microsoft.PowerShell.Security, and Get-AuthenticodeSignature
// answers nothing (#85, CI's Windows runner). Without it, Windows
// PowerShell finds its own.
export function signatureEnvironment(file: string, from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...from, QG_SIGNED_FILE: file };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return env;
}

export function windowsSigner(file: string): WindowsSigner | null {
  const read = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000,
    env: signatureEnvironment(file)
  });
  if (read.status !== 0 || typeof read.stdout !== 'string') return null;
  return parseSigner(read.stdout);
}

// The check the updater makes, before it keeps a download and again before
// it runs it: signed by whoever signed this running copy, or by us when it is unsigned.
export function signedLikeThisCopy(installer: string): boolean {
  return samePublisher(windowsSigner(process.execPath), windowsSigner(installer));
}
