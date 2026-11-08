; SPDX-License-Identifier: AGPL-3.0-only
; The pinned electron-builder 26.17.0 installer is an x86 PE32 process.
; Select native Windows PowerShell without changing its upstream MIT guard.
; Stock suppresses these declarations when customCheckAppRunning exists.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
	${If} ${RunningX64}
	${OrIf} ${IsNativeARM64}
		StrCpy $PowerShellPath "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
	${EndIf}
	!insertmacro IS_POWERSHELL_AVAILABLE
	!insertmacro _CHECK_APP_RUNNING
!macroend
