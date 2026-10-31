# SPDX-License-Identifier: AGPL-3.0-only

param(
	[Parameter(Mandatory = $true)]
	[ValidateSet('x64', 'arm64')]
	[string] $Architecture,
	[Parameter(Mandatory = $true)]
	[ValidateSet('Soundscaper', 'Framescaper')]
	[string] $ProductName,
	[Parameter(Mandatory = $true)]
	[ValidatePattern('^Local\\org\.(soundscaper|framescaper)\.desktop\.FFmpeg\.\{[0-9a-fA-F-]{36}\}$')]
	[string] $CompletionEvent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-WinGet {
	$candidates = @((Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'))
	$package = Get-AppxPackage -Name Microsoft.DesktopAppInstaller -ErrorAction SilentlyContinue |
		Select-Object -First 1
	if ($null -ne $package -and $package.InstallLocation) {
		$candidates += Join-Path $package.InstallLocation 'winget.exe'
	}
	foreach ($candidate in $candidates) {
		if (Test-Path -LiteralPath $candidate -PathType Leaf) {
			try {
				& $candidate --version | Out-Null
				if ($LASTEXITCODE -eq 0) { return $candidate }
			} catch { }
		}
	}
	return $null
}

function Install-WinGetIfMissing {
	$winget = Find-WinGet
	if ($null -ne $winget) { return $winget }
	Write-Host 'Installing Microsoft WinGet/App Installer for your Windows account...'
	# Official Microsoft bootstrap, scoped to the interactive user. PSGallery
	# trust and execution-policy changes are never persisted by this installer.
	# https://learn.microsoft.com/windows/package-manager/winget/
	[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
	Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null
	Install-Module -Name Microsoft.WinGet.Client -Scope CurrentUser -Repository PSGallery -Force -AllowClobber
	Import-Module Microsoft.WinGet.Client -ErrorAction Stop
	Repair-WinGetPackageManager -Latest -ErrorAction Stop | Out-Null
	$winget = Find-WinGet
	if ($null -eq $winget) { throw 'WinGet could not be installed for your Windows account.' }
	return $winget
}

function Test-FfmpegInstalled {
	$root = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet'
	$candidates = @((Join-Path $root 'Links\ffmpeg.exe'))
	$packages = @(Get-ChildItem -LiteralPath (Join-Path $root 'Packages') -Directory -Filter 'BtbN.FFmpeg.GPL.8.1_*' -ErrorAction SilentlyContinue)
	foreach ($package in $packages) {
		$candidates += @(Get-ChildItem -LiteralPath $package.FullName -File -Recurse -Depth 3 -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
			ForEach-Object { $_.FullName })
	}
	foreach ($candidate in $candidates) {
		$probe = Join-Path (Split-Path $candidate -Parent) 'ffprobe.exe'
		if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and (Test-Path -LiteralPath $probe -PathType Leaf)) {
			try {
				& $candidate -version | Out-Null
				if ($LASTEXITCODE -ne 0) { continue }
				& $probe -version | Out-Null
				if ($LASTEXITCODE -eq 0) { return $true }
			} catch { }
		}
	}
	return $false
}

function Install-FfmpegWithWinGet([string] $Winget, [string] $TargetArchitecture) {
	if (Test-FfmpegInstalled) { return }
	Write-Host 'Installing FFmpeg (BtbN GPL 8.1 release branch)...'
	$arguments = @(
		'install', '--exact', '--id', 'BtbN.FFmpeg.GPL.8.1',
		'--source', 'winget', '--architecture', $TargetArchitecture,
		'--scope', 'user', '--disable-interactivity',
		'--accept-package-agreements', '--accept-source-agreements'
	)
	& $Winget @arguments
	if ($LASTEXITCODE -ne 0) { throw "WinGet could not install FFmpeg (exit code $LASTEXITCODE)." }
	if (-not (Test-FfmpegInstalled)) { throw 'WinGet completed but a working FFmpeg/FFprobe pair was not found.' }
}

function Assert-InteractiveUser([bool] $IsSystem, [bool] $IsAdministrator) {
	if ($IsSystem -or $IsAdministrator) {
		throw 'FFmpeg setup must run as the interactive Windows user without administrator elevation.'
	}
}

function Write-InstallerConsent([ValidateSet('Soundscaper', 'Framescaper')][string] $ApplicationName) {
	if ([string]::IsNullOrEmpty($env:APPDATA) -or -not [IO.Path]::IsPathRooted($env:APPDATA)) {
		throw 'The interactive Windows account has no absolute application-data directory.'
	}
	$settings = Join-Path $env:APPDATA $ApplicationName
	[IO.Directory]::CreateDirectory($settings) | Out-Null
	$marker = Join-Path $settings 'ffmpeg-installer-consent'
	[IO.File]::WriteAllText($marker, "1`n", (New-Object Text.UTF8Encoding($false)))
}

function Install-OptionalFfmpeg([bool] $IsSystem, [bool] $IsAdministrator, [string] $ApplicationName, [string] $TargetArchitecture) {
	Assert-InteractiveUser -IsSystem $IsSystem -IsAdministrator $IsAdministrator
	$winget = Install-WinGetIfMissing
	Install-FfmpegWithWinGet -Winget $winget -TargetArchitecture $TargetArchitecture
	Write-InstallerConsent -ApplicationName $ApplicationName
}

$completion = $null
$succeeded = $false
try {
	# Refuse to continue if the launch did not actually leave the elevated
	# administrator account: per-user packages must belong to the desktop user.
	$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
	$principal = New-Object Security.Principal.WindowsPrincipal($identity)
	$completion = [Threading.EventWaitHandle]::OpenExisting("$CompletionEvent.failure")
	Install-OptionalFfmpeg -IsSystem $identity.IsSystem -IsAdministrator $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -ApplicationName $ProductName -TargetArchitecture $Architecture
	$completion.Dispose()
	$completion = [Threading.EventWaitHandle]::OpenExisting("$CompletionEvent.success")
	$succeeded = $true
	Write-Host 'FFmpeg support is ready.'
} catch {
	Write-Host "FFmpeg installation failed: $($_.Exception.Message)" -ForegroundColor Red
	if ($null -eq $completion) {
		try { $completion = [Threading.EventWaitHandle]::OpenExisting("$CompletionEvent.failure") }
		catch { }
	}
} finally {
	if ($null -ne $completion) {
		$completion.Set() | Out-Null
		$completion.Dispose()
	}
}

if (-not $succeeded) {
	Write-Host 'The application is installed. You can retry FFmpeg setup in Edit > Preferences > General.'
	Read-Host 'Press Enter to close this window' | Out-Null
	exit 1
}
exit 0
