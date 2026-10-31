; SPDX-License-Identifier: AGPL-3.0-only

!include nsDialogs.nsh
!include LogicLib.nsh
!include x64.nsh
!include MUI2.nsh

!ifndef BUILD_UNINSTALLER
Var ffmpegCheckbox
Var ffmpegSelected
Var ffmpegEventName
Var ffmpegSuccessEvent
Var ffmpegFailureEvent

!macro customInit
	StrCpy $ffmpegSelected ${BST_UNCHECKED}
!macroend

!macro customPageAfterChangeDir
	Page custom FfmpegPageCreate FfmpegPageLeave
!macroend

Function FfmpegPageCreate
	${If} ${Silent}
		Abort
	${EndIf}
	${If} ${isUpdated}
		Abort
	${EndIf}
	!insertmacro MUI_HEADER_TEXT "Optional file format support" "Choose whether to add FFmpeg support."
	nsDialogs::Create 1018
	Pop $0
	${If} $0 == error
		Abort
	${EndIf}
	${NSD_CreateCheckbox} 0 0 100% 32u "Add FFmpeg-support for proprietary file formats (M4A, MP4, MOV and more)"
	Pop $ffmpegCheckbox
	${NSD_SetState} $ffmpegCheckbox $ffmpegSelected
	${NSD_CreateLabel} 0 42u 100% 74u "Selecting this option installs FFmpeg (GPL-3.0) for your Windows account through WinGet. If needed, it also installs Microsoft's WinGet/App Installer and its dependencies. This requires internet access and accepts the package and source agreements."
	Pop $0
	nsDialogs::Show
FunctionEnd

Function FfmpegPageLeave
	${NSD_GetState} $ffmpegCheckbox $ffmpegSelected
FunctionEnd

; A per-machine installer is elevated. Launch the helper through the desktop
; shell so WinGet, App Installer and FFmpeg belong to the interactive user.
; Random, session-local events carry completion without writable script files.
Function InstallOptionalFfmpeg
	StrCpy $ffmpegSuccessEvent 0
	StrCpy $ffmpegFailureEvent 0
	System::Alloc 16
	Pop $0
	System::Call 'ole32::CoCreateGuid(p r0)i.r1'
	${If} $1 != 0
		System::Free $0
		Goto ffmpegLaunchFailed
	${EndIf}
	System::Call 'ole32::StringFromGUID2(p r0, w .r1, i 39)i.r2'
	System::Free $0
	${If} $2 == 0
		Goto ffmpegLaunchFailed
	${EndIf}
	StrCpy $ffmpegEventName "Local\${APP_ID}.FFmpeg.$1"
	; Permit the interactive user to signal completion even when elevation used
	; credentials for a different administrator. Events never authorize code.
	System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w "D:(A;;GA;;;BA)(A;;GA;;;SY)(A;;0x00100002;;;IU)", i 1, *p .r0, p 0)i.r1'
	${If} $1 == 0
		Goto ffmpegLaunchFailed
	${EndIf}
	System::Call '*(i 12, p r0, i 0)p.r1'
	System::Call 'kernel32::CreateEventW(p r1, i 1, i 0, w "$ffmpegEventName.success")p.r2'
	StrCpy $ffmpegSuccessEvent $2
	System::Call 'kernel32::CreateEventW(p r1, i 1, i 0, w "$ffmpegEventName.failure")p.r2'
	StrCpy $ffmpegFailureEvent $2
	System::Free $1
	System::Call 'kernel32::LocalFree(p r0)'
	${If} $ffmpegSuccessEvent == 0
	${OrIf} $ffmpegFailureEvent == 0
		Goto ffmpegLaunchFailed
	${EndIf}
	${If} ${IsNativeARM64}
		StrCpy $0 "arm64"
	${Else}
		StrCpy $0 "x64"
	${EndIf}
	DetailPrint "Installing optional FFmpeg for the interactive Windows user..."
	${StdUtils.ExecShellAsUser} $1 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" "open" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\windows-ffmpeg-install.ps1" -Architecture "$0" -ProductName "${PRODUCT_NAME}" -CompletionEvent "$ffmpegEventName"'
	${If} $1 != "ok"
		Goto ffmpegLaunchFailed
	${EndIf}
	System::Call '*(p $ffmpegSuccessEvent, p $ffmpegFailureEvent)p.r0'
	StrCpy $2 0
	ffmpegWait:
		System::Call 'kernel32::WaitForMultipleObjects(i 2, p r0, i 0, i 100)i.r1'
		${If} $1 == 0
			System::Free $0
			DetailPrint "Optional FFmpeg installation completed."
			Goto ffmpegCleanup
		${EndIf}
		${If} $1 != 258
			System::Free $0
			Goto ffmpegInstallFailed
		${EndIf}
		IntOp $2 $2 + 1
		${If} $2 >= 18000
			System::Free $0
			MessageBox MB_OK|MB_ICONEXCLAMATION "FFmpeg installation has not reported completion after 30 minutes. Check the PowerShell installation window before launching ${PRODUCT_NAME}."
			Goto ffmpegCleanup
		${EndIf}
		Sleep 1
		Goto ffmpegWait
	ffmpegLaunchFailed:
		MessageBox MB_OK|MB_ICONEXCLAMATION "FFmpeg installation could not start for your Windows account. ${PRODUCT_NAME} is installed. You can retry FFmpeg setup in Edit > Preferences > General."
		Goto ffmpegCleanup
	ffmpegInstallFailed:
		MessageBox MB_OK|MB_ICONEXCLAMATION "FFmpeg installation failed. ${PRODUCT_NAME} is installed. The PowerShell window shows the error; you can retry FFmpeg setup in Edit > Preferences > General."
	ffmpegCleanup:
		${If} $ffmpegSuccessEvent != 0
			System::Call 'kernel32::CloseHandle(p $ffmpegSuccessEvent)'
		${EndIf}
		${If} $ffmpegFailureEvent != 0
			System::Call 'kernel32::CloseHandle(p $ffmpegFailureEvent)'
		${EndIf}
FunctionEnd

!macro customInstall
	${IfNot} ${Silent}
	${AndIf} $ffmpegSelected == ${BST_CHECKED}
		Call InstallOptionalFfmpeg
	${EndIf}
!macroend
!endif
