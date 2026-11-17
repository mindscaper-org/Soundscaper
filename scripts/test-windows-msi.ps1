# SPDX-License-Identifier: AGPL-3.0-only
# Run on a disposable Windows runner. Never overwrite an existing MSI installation.
param(
    [Parameter(Mandatory=$true)][string]$Artifact,
    [Parameter(Mandatory=$true)][ValidateSet('Soundscaper','Framescaper')][string]$ProductName
)
$ErrorActionPreference = 'Stop'
$Artifact = (Resolve-Path -LiteralPath $Artifact).Path
$key = "HKEY_LOCAL_MACHINE\Software\Mindscaper\$ProductName\Installation"
if ($null -ne [Microsoft.Win32.Registry]::GetValue($key, 'ManagedByWindowsInstaller', $null)) {
    throw "An existing $ProductName MSI installation must not be modified by this test"
}
$logRoot = Join-Path $env:TEMP ("scape-msi-test-" + [guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($logRoot)
$profile = Join-Path $env:APPDATA $ProductName
[void][IO.Directory]::CreateDirectory($profile)
$sentinel = Join-Path $profile ("msi-preservation-" + [guid]::NewGuid() + '.txt')
[IO.File]::WriteAllText($sentinel, 'preserve user data')
$installed = $false
function Invoke-Installer($operation, $label) {
    $log = Join-Path $logRoot "$label.log"
    $arguments = @($operation, ('"' + $Artifact + '"'), '/qn', '/norestart', '/l*v', ('"' + $log + '"'))
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) { throw "MSI $label failed with exit code $($process.ExitCode); log: $log" }
}
try {
    Invoke-Installer '/i' 'install'
    $installed = $true
    if ([Microsoft.Win32.Registry]::GetValue($key, 'ManagedByWindowsInstaller', 0) -ne 1) { throw 'MSI ownership marker is missing' }
    $application = Join-Path $env:ProgramFiles $ProductName
    if (-not (Test-Path -LiteralPath (Join-Path $application "$ProductName.exe"))) { throw 'Per-machine application executable is missing' }
    $productId = $ProductName.ToLowerInvariant()
    foreach ($relative in @("resources\policies\$productId.admx", "resources\policies\en-US\$productId.adml")) {
        [xml]$definition = Get-Content -LiteralPath (Join-Path $application $relative) -Raw
        if ($null -eq $definition.DocumentElement) { throw 'Installed policy template is invalid' }
    }
    Invoke-Installer '/fa' 'repair'
    Invoke-Installer '/x' 'uninstall'
    $installed = $false
    if ($null -ne [Microsoft.Win32.Registry]::GetValue($key, 'ManagedByWindowsInstaller', $null)) { throw 'MSI ownership marker survived uninstall' }
    if ([IO.File]::ReadAllText($sentinel) -ne 'preserve user data') { throw 'MSI modified user preferences' }
    Write-Host "$ProductName MSI installation, repair, uninstall and user-data preservation passed. Logs: $logRoot"
} finally {
    if ($installed) { Invoke-Installer '/x' 'cleanup' }
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
}
