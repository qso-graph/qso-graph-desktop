// SPDX-License-Identifier: GPL-3.0-only
// Microsoft's Visual C++ runtime on Windows (#91, QGD-SCP-0010). The credential core and
// its FIPS crypto module import VCRUNTIME140.dll, which a freshly installed
// Windows 11 does not have; without it the core cannot start, and nothing
// that goes online works. We do not ship Microsoft's DLL (KI7MT,
// 2026-10-25): the installer runs Microsoft's own installer (a Microsoft Store copy
// is the same installer, #86), and this is what catches the rest
// (the portable zip, or an install made offline): a plain message with
// Microsoft's page, never a silent failure.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Where Windows's loader finds it: the system folder. The application is a
// 64-bit process, so this is the 64-bit System32, never SysWOW64.
export function windowsRuntimeMissing(platform: string, systemRoot: string | undefined, exists: (path: string) => boolean = existsSync): boolean {
  if (platform !== 'win32') return false;
  if (!systemRoot) return true;
  return !exists(join(systemRoot, 'System32', 'vcruntime140.dll'));
}

export const RUNTIME_MESSAGE = {
  title: 'A Microsoft component is missing',
  message: "QSO Graph Desktop needs Microsoft's Visual C++ runtime, and this PC doesn't have it.",
  detail: "Until it's installed, nothing that goes online works: no downloads and no logins. "
    + "Microsoft's page has the installer: choose the X64 one, vc_redist.x64.exe. "
    + 'Install it, then restart QSO Graph Desktop.',
  buttons: ["Open Microsoft's page", 'Not now']
};
