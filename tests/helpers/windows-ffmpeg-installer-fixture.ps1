# SPDX-License-Identifier: AGPL-3.0-only

param([Parameter(Mandatory = $true)][string] $InstallerScript)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($InstallerScript, [ref] $tokens, [ref] $errors)
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
	Invoke-Expression $definition.Extent.Text
}

function Assert-Equal($Actual, $Expected, [string] $Label) {
	if ($Actual -cne $Expected) { throw "$Label : expected '$Expected', received '$Actual'." }
}

$script:findCalls = 0
$script:wingetMissing = $false
$script:repairFails = $false
$script:bootstrapCalls = New-Object 'Collections.Generic.List[string]'
function Find-WinGet {
	$script:findCalls++
	if ($script:wingetMissing -and $script:findCalls -eq 1) { return $null }
	return 'Invoke-FakeWinget'
}
function Install-PackageProvider($Name, $MinimumVersion, $Scope, [switch] $Force) {
	Assert-Equal $Name 'NuGet' 'Bootstrap provider'
	Assert-Equal $Scope 'CurrentUser' 'Provider scope'
	Assert-Equal $Force.IsPresent $true 'Provider unattended operation'
	$script:bootstrapCalls.Add('provider')
}
function Install-Module($Name, $Scope, $Repository, [switch] $Force, [switch] $AllowClobber) {
	Assert-Equal $Name 'Microsoft.WinGet.Client' 'Official bootstrap module'
	Assert-Equal $Scope 'CurrentUser' 'Module scope'
	Assert-Equal $Repository 'PSGallery' 'Official module source'
	Assert-Equal $Force.IsPresent $true 'Module unattended operation'
	$script:bootstrapCalls.Add('module')
}
function Import-Module($Name, $ErrorAction) {
	Assert-Equal $Name 'Microsoft.WinGet.Client' 'Imported module'
	$script:bootstrapCalls.Add('import')
}
function Repair-WinGetPackageManager([switch] $Latest, $ErrorAction) {
	Assert-Equal $Latest.IsPresent $true 'Stable WinGet bootstrap'
	$script:bootstrapCalls.Add('repair')
	if ($script:repairFails) { throw 'Expected repair failure.' }
}

Assert-Equal (Install-WinGetIfMissing) 'Invoke-FakeWinget' 'Existing WinGet'
Assert-Equal $script:bootstrapCalls.Count 0 'No bootstrap when WinGet exists'
$script:findCalls = 0
$script:wingetMissing = $true
Assert-Equal (Install-WinGetIfMissing) 'Invoke-FakeWinget' 'Bootstrapped WinGet'
Assert-Equal ($script:bootstrapCalls -join ',') 'provider,module,import,repair' 'Bootstrap order'
$script:findCalls = 0
$script:repairFails = $true
$failed = $false
try { Install-WinGetIfMissing | Out-Null } catch { $failed = $true }
Assert-Equal $failed $true 'Bootstrap failures propagate'

$script:pairChecks = 0
$script:pairExists = $false
$script:postInstallWorks = $true
$script:wingetCalls = 0
$script:wingetArguments = @()
$script:wingetExit = 0
function Test-FfmpegInstalled {
	$script:pairChecks++
	return $script:pairExists -or ($script:pairChecks -gt 1 -and $script:postInstallWorks)
}
function Invoke-FakeWinget {
	$script:wingetCalls++
	$script:wingetArguments = @($args)
	$global:LASTEXITCODE = $script:wingetExit
}
foreach ($target in @('x64', 'arm64')) {
	$script:pairChecks = 0
	Install-FfmpegWithWinGet -Winget 'Invoke-FakeWinget' -TargetArchitecture $target
	Assert-Equal ($script:wingetArguments -join '|') "install|--exact|--id|BtbN.FFmpeg.GPL.8.1|--source|winget|--architecture|$target|--scope|user|--disable-interactivity|--accept-package-agreements|--accept-source-agreements" 'Exact FFmpeg package invocation'
}
$script:pairChecks = 0
$script:pairExists = $true
$script:wingetCalls = 0
Install-FfmpegWithWinGet -Winget 'Invoke-FakeWinget' -TargetArchitecture x64
Assert-Equal $script:wingetCalls 0 'A working FFmpeg pair is reused'
$script:pairExists = $false
foreach ($scenario in @('nonzero', 'missing-pair')) {
	$script:pairChecks = 0
	$script:wingetExit = 0
	$script:postInstallWorks = $true
	if ($scenario -eq 'nonzero') { $script:wingetExit = 42 }
	else { $script:postInstallWorks = $false }
	$failed = $false
	try { Install-FfmpegWithWinGet -Winget 'Invoke-FakeWinget' -TargetArchitecture arm64 }
	catch { $failed = $true }
	Assert-Equal $failed $true "$scenario failure propagates"
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('scape-ffmpeg-account-' + [guid]::NewGuid().ToString('N'))
$priorApplicationData = $env:APPDATA
$priorLocalApplicationData = $env:LOCALAPPDATA
$script:installationCalls = New-Object 'Collections.Generic.List[string]'
$script:installationFails = $false
function Install-WinGetIfMissing {
	$script:installationCalls.Add('winget')
	return 'Invoke-FakeWinget'
}
function Install-FfmpegWithWinGet($Winget, $TargetArchitecture) {
	Assert-Equal $Winget 'Invoke-FakeWinget' 'Admitted package manager'
	Assert-Equal $TargetArchitecture 'arm64' 'Admitted target architecture'
	$script:installationCalls.Add('ffmpeg')
	if ($script:installationFails) { throw 'Expected FFmpeg installation failure.' }
}
try {
	$env:APPDATA = Join-Path $temporary 'interactive-account'
	$env:LOCALAPPDATA = Join-Path $temporary 'administrator-account'
	foreach ($identity in @(@($true, $false), @($false, $true), @($true, $true))) {
		$failed = $false
		try { Install-OptionalFfmpeg -IsSystem $identity[0] -IsAdministrator $identity[1] -ApplicationName Soundscaper -TargetArchitecture arm64 }
		catch { $failed = $true }
		Assert-Equal $failed $true 'Elevated/system account is refused'
		Assert-Equal $script:installationCalls.Count 0 'Refused account does not start package installation'
		Assert-Equal ([IO.Directory]::Exists($temporary)) $false 'Refused account writes no consent marker'
	}
	$script:installationFails = $true
	$failed = $false
	try { Install-OptionalFfmpeg -IsSystem $false -IsAdministrator $false -ApplicationName Soundscaper -TargetArchitecture arm64 }
	catch { $failed = $true }
	Assert-Equal $failed $true 'FFmpeg failure propagates through installation orchestration'
	Assert-Equal ([IO.Directory]::Exists($temporary)) $false 'Failed installation writes no consent marker'
	$script:installationFails = $false
	$script:installationCalls.Clear()
	foreach ($product in @('Soundscaper', 'Framescaper')) {
		Install-OptionalFfmpeg -IsSystem $false -IsAdministrator $false -ApplicationName $product -TargetArchitecture arm64
		$marker = Join-Path (Join-Path $env:APPDATA $product) 'ffmpeg-installer-consent'
		Assert-Equal ([IO.File]::ReadAllText($marker)) "1`n" 'Per-product consent content'
		Assert-Equal ([IO.File]::ReadAllBytes($marker) -join ',') '49,10' 'Consent marker has no BOM or CRLF'
	}
	Assert-Equal ($script:installationCalls -join ',') 'winget,ffmpeg,winget,ffmpeg' 'Consent follows completed package installation'
	Assert-Equal ([IO.Directory]::Exists($env:LOCALAPPDATA)) $false 'Administrator/local-data directory remains untouched'
	$env:APPDATA = 'relative-account-data'
	$failed = $false
	try { Write-InstallerConsent -ApplicationName Soundscaper } catch { $failed = $true }
	Assert-Equal $failed $true 'Missing absolute account data refuses marker publication'
} finally {
	$env:APPDATA = $priorApplicationData
	$env:LOCALAPPDATA = $priorLocalApplicationData
	if ([IO.Directory]::Exists($temporary)) { [IO.Directory]::Delete($temporary, $true) }
}
Write-Host 'Windows FFmpeg bootstrap scenarios passed'
