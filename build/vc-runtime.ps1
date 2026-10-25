# SPDX-License-Identifier: GPL-3.0-only
# Microsoft's Visual C++ runtime, for the Windows installer (#91). The
# credential core and its FIPS crypto module import VCRUNTIME140.dll, which a
# freshly installed Windows 11 does not have. We never ship Microsoft's DLL
# (KI7MT, 2026-10-25): if it is missing, this downloads Microsoft's own
# installer from Microsoft, runs it only if Windows finds it validly signed
# by Microsoft Corporation, and lets it install the runtime. That is one
# Windows administrator prompt, once per PC.
#
# Run by the installer (build/installer.nsh) with Windows PowerShell, and by
# CI, which checks each answer (.github/workflows/ci.yml). Exit codes:
#   0   the runtime is there, or is now installed (or, -VerifyOnly, the
#       download is Microsoft's)
#   10  Microsoft's installer could not be downloaded (no internet?)
#   11  what was downloaded is not validly signed by Microsoft: not run
#   12  the administrator prompt was declined, or the installer did not start
#   13  Microsoft's installer ran and reported a failure
param(
  # Microsoft's permanent address for the latest x64 runtime.
  [string]$Url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
  # Download and check the signature, but install nothing: CI's check.
  [switch]$VerifyOnly,
  # A file already on disk in place of the download: CI's planted case.
  [string]$From = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Where Windows's loader looks: the 64-bit system folder. From a 32-bit
# process (the installer is one), that folder is reached as Sysnative.
$system = if ([Environment]::Is64BitProcess) { 'System32' } else { 'Sysnative' }
$dll = Join-Path $env:SystemRoot "$system\vcruntime140.dll"
if (-not $VerifyOnly -and -not $From -and (Test-Path -LiteralPath $dll)) {
  Write-Host "Microsoft's Visual C++ runtime is installed."
  exit 0
}

if ($From) {
  $file = $From
} else {
  $file = Join-Path ([IO.Path]::GetTempPath()) ("vc_redist.x64-{0}.exe" -f [Guid]::NewGuid())
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $file -UseBasicParsing
  } catch {
    Write-Host "Microsoft's installer could not be downloaded."
    exit 10
  }
}

# The answer, worked out before anything is cleaned up: `exit` inside a try
# does not reliably run its finally.
function Install-Checked([string]$Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
  if ($signature.Status -ne 'Valid' -or $signer -notmatch '(^|, )CN=Microsoft Corporation(,|$)') {
    Write-Host "Not run: it is not validly signed by Microsoft ($($signature.Status), $signer)."
    return 11
  }
  Write-Host "Signed by Microsoft: $signer"
  if ($VerifyOnly) { return 0 }
  try {
    $run = Start-Process -FilePath $Path -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -Wait -PassThru
  } catch {
    Write-Host "Microsoft's installer did not start: the administrator prompt was declined."
    return 12
  }
  # 1638: a newer runtime is already installed. 3010: installed, restart later.
  if ($run.ExitCode -in 0, 1638, 3010) {
    Write-Host "Microsoft's Visual C++ runtime is installed."
    return 0
  }
  Write-Host "Microsoft's installer reported a failure ($($run.ExitCode))."
  return 13
}

try { $code = Install-Checked $file } catch { Write-Host "The check failed: $($_.Exception.Message)"; $code = 11 }
if (-not $From) { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
exit $code
