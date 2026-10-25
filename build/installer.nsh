; SPDX-License-Identifier: GPL-3.0-only
; The Windows installer's own step (#91): Microsoft's Visual C++ runtime,
; which a freshly installed Windows 11 lacks and the credential core needs.
; build/vc-runtime.ps1 does the work: present, nothing happens; missing, it
; downloads Microsoft's installer, runs it only if it is validly signed by
; Microsoft, and Windows asks for an administrator once. If it cannot, the
; operator is told why, and the application says so again when it starts,
; with Microsoft's page.

!macro customInstall
  File "/oname=$PLUGINSDIR\vc-runtime.ps1" "${BUILD_RESOURCES_DIR}\vc-runtime.ps1"
  DetailPrint "Checking for Microsoft's Visual C++ runtime..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\vc-runtime.ps1"'
  Pop $0
  ${if} $0 != "0"
    ${if} $0 == "10"
      StrCpy $1 "it could not be downloaded from Microsoft. Is this PC online?"
    ${elseif} $0 == "11"
      StrCpy $1 "what was downloaded was not signed by Microsoft, so it was not run."
    ${elseif} $0 == "12"
      StrCpy $1 "Windows' administrator prompt was declined."
    ${else}
      StrCpy $1 "Microsoft's installer did not finish ($0)."
    ${endif}
    DetailPrint "Microsoft's Visual C++ runtime was not installed: $1"
    ${ifNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "QSO Graph Desktop needs Microsoft's Visual C++ runtime, and it was not installed: $1$\r$\n$\r$\nQSO Graph Desktop will say so when it starts, with Microsoft's page to get it from."
    ${endif}
  ${endif}
!macroend
