# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RequestPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Require-Keys($Value, [string[]]$Required, [string[]]$Optional = @()) {
	if ($null -eq $Value -or $Value -is [string] -or $Value -is [Array]) { throw 'An object is required.' }
	$names = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
	foreach ($name in $Required) { if ($names -cnotcontains $name) { throw "Missing request field: $name" } }
	foreach ($name in $names) { if (($Required -cnotcontains $name) -and ($Optional -cnotcontains $name)) { throw "Unknown request field: $name" } }
}
function Require-String($Value, [int]$Maximum = 32767) {
	if ($Value -isnot [string] -or $Value.Length -eq 0 -or $Value.Length -gt $Maximum -or $Value.IndexOf([char]0) -ge 0) { throw 'A bounded nonempty string is required.' }
	return $Value
}
function Require-Integer($Value, [long]$Minimum, [long]$Maximum) {
	if (($Value -isnot [int]) -and ($Value -isnot [long])) { throw 'An integer is required.' }
	if ($Value -lt $Minimum -or $Value -gt $Maximum) { throw 'Integer is outside its bound.' }
	return [long]$Value
}
function Read-Identity($Value) {
	Require-Keys $Value @('platform','pid','parent','birth','executable')
	if ($Value.platform -cne 'win32') { throw 'A Windows identity is required.' }
	$identity = New-Object Soundscaper.Qualification.Win32.Identity
	$identity.platform = 'win32'
	$identity.pid = [uint32](Require-Integer $Value.pid 1 ([uint32]::MaxValue))
	$identity.parent = [uint32](Require-Integer $Value.parent 0 ([uint32]::MaxValue))
	$identity.birth = Require-String $Value.birth 20
	if ($identity.birth -cnotmatch '^[1-9][0-9]{0,19}$') { throw 'Creation FILETIME must be decimal text.' }
	$null = [uint64]::Parse($identity.birth, [Globalization.CultureInfo]::InvariantCulture)
	$identity.executable = Require-String $Value.executable
	$identity.executable = [Soundscaper.Qualification.Win32.Native]::FullLocalPath($identity.executable)
	return $identity
}
function Read-Custody($Value) {
	Require-Keys $Value @('directory','id','jobName','controlId')
	$custody = New-Object Soundscaper.Qualification.Win32.Custody
	$custody.directory = [Soundscaper.Qualification.Win32.Native]::CanonicalDirectory((Require-String $Value.directory))
	$custody.id = Require-String $Value.id 80
	$custody.jobName = Require-String $Value.jobName 100
	$custody.controlId = Require-String $Value.controlId 32
	$null = [Soundscaper.Qualification.Win32.Native]::CustodyFile($custody.directory,$custody.id,'.owner.json')
	return $custody
}
function Same-Identity($Left, $Right) {
	return $Left.platform -ceq $Right.platform -and $Left.pid -eq $Right.pid -and $Left.parent -eq $Right.parent -and $Left.birth -ceq $Right.birth -and [string]::Equals($Left.executable,$Right.executable,[StringComparison]::OrdinalIgnoreCase)
}
function Open-Grant($OwnerValue, $CustodyValue, [bool]$MayKill) {
	$owner = Read-Identity $OwnerValue
	$custody = Read-Custody $CustodyValue
	$file = [Soundscaper.Qualification.Win32.Native]::CustodyFile($custody.directory,$custody.id,'.owner.json')
	if (([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point owner receipt refused.' }
	$stream = [IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
	$grant = $null
	try {
		if ($stream.Length -gt 65536) { throw 'Owner receipt exceeds its bound.' }
		$reader = [IO.StreamReader]::new($stream,[Text.UTF8Encoding]::new($false,$true),$true,4096,$true)
		try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
		[Soundscaper.Qualification.Win32.Native]::AssertUniqueJsonKeys($text)
		$record = ConvertFrom-Json -InputObject $text
		Require-Keys $record @('owner','custody','controller')
		$recordOwner = Read-Identity $record.owner
		$controller = Read-Identity $record.controller
		$recordCustody = Read-Custody $record.custody
		if (-not (Same-Identity $owner $recordOwner)) { throw 'Owner receipt identity differs.' }
		foreach ($key in @('directory','id','jobName','controlId')) {
			if ($custody.$key -cne $recordCustody.$key) { throw 'Owner receipt custody differs.' }
		}
		$grant = [Soundscaper.Qualification.Win32.Native]::Acquire($owner,$custody,$controller,$MayKill)
		return [pscustomobject]@{ grant=$grant; stream=$stream }
	} catch {
		if ($null -ne $grant) { $grant.Dispose() }
		$stream.Dispose()
		throw
	}
}
function Write-Json($Value) {
	[Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Depth 16 -Compress))
}

$runClosure = $null
$closureWritten = $false
try {
	if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This helper runs only on Windows.' }
	$null = Add-Type -AssemblyName UIAutomationClient
	$null = Add-Type -AssemblyName UIAutomationTypes
	$references = @('System.dll','System.Core.dll',[System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.ValuePatternIdentifiers].Assembly.Location)
	$null = Add-Type -Path @(
		(Join-Path $PSScriptRoot 'motionscaper-qualification-win32-native.cs'),
		(Join-Path $PSScriptRoot 'motionscaper-qualification-win32-run.cs'),
		(Join-Path $PSScriptRoot 'motionscaper-qualification-win32-uia.cs')
	) -ReferencedAssemblies $references
	$null = [Soundscaper.Qualification.Win32.Native]::Architecture()
	$inputFile = [IO.Path]::GetFullPath($RequestPath)
	if (([IO.File]::GetAttributes($inputFile) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point request refused.' }
	$inputStream = [IO.File]::Open($inputFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
	try {
		if ($inputStream.Length -gt 65536) { throw 'Request exceeds its bound.' }
		$reader = [IO.StreamReader]::new($inputStream,[Text.UTF8Encoding]::new($false,$true))
		try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
	} finally { $inputStream.Dispose() }
	[Soundscaper.Qualification.Win32.Native]::AssertUniqueJsonKeys($text)
	$request = ConvertFrom-Json -InputObject $text
	if ((Require-Integer $request.schemaVersion 1 1) -ne 1) { throw 'Unsupported request version.' }
	switch -CaseSensitive (Require-String $request.action 16) {
		'probe' {
			Require-Keys $request @('schemaVersion','action')
			Write-Json ([pscustomobject]@{ schemaVersion=1; platform='win32'; architecture=[Soundscaper.Qualification.Win32.Native]::Architecture(); capabilities=[pscustomobject]@{ retainedHandleFiletime=$true; suspendedOwnedJob=$true; exactOwnedUiAutomation=$true; stdinControlPipeRequired=$true; interactiveDesktop=[Environment]::UserInteractive }; hostQualified=$false })
		}
		'inspect' {
			Require-Keys $request @('schemaVersion','action','pid')
			Write-Json ([Soundscaper.Qualification.Win32.Native]::Inspect([uint32](Require-Integer $request.pid 1 ([uint32]::MaxValue))))
		}
		'snapshot' {
			Require-Keys $request @('schemaVersion','action')
			Write-Json ([Soundscaper.Qualification.Win32.Native]::Snapshot())
		}
		'signal' {
			Require-Keys $request @('schemaVersion','action','owner','custody','signal')
			$signal = Require-String $request.signal 4
			if ($signal -cne 'TERM' -and $signal -cne 'KILL') { throw 'Invalid owned signal.' }
			$lease = Open-Grant $request.owner $request.custody ($signal -ceq 'KILL')
			try {
				if ($signal -ceq 'KILL') { $lease.grant.Kill(); $windows = 0 } else { $windows = [Soundscaper.Qualification.Win32.OwnedUi]::CloseOwnedWindows($lease.grant) }
				Write-Json ([pscustomobject]@{ schemaVersion=1; platform='win32'; requested=$signal; owner=$lease.grant.Owner; invoked=$true; windows=$windows; retirementClaimed=$false })
			} finally { $lease.grant.Dispose(); $lease.stream.Dispose() }
		}
		'choose' {
			Require-Keys $request @('schemaVersion','action','choose','custody')
			$value = $request.choose
			Require-Keys $value @('schemaVersion','owner','kind','path','directory','caption','action') @('linuxMode')
			$null = Require-Integer $value.schemaVersion 1 1
			$lease = Open-Grant $value.owner $request.custody $false
			try {
				Write-Json ([Soundscaper.Qualification.Win32.OwnedUi]::Choose($lease.grant,(Require-String $value.kind 80),(Require-String $value.path),(Require-String $value.directory),(Require-String $value.caption 512),(Require-String $value.action 6)))
			} finally { $lease.grant.Dispose(); $lease.stream.Dispose() }
		}
		'run' {
			Require-Keys $request @('schemaVersion','action','executable','args','cwd','directory','id','timeoutMs','ownerFile','closureFile') @('maximumOutputBytes')
			if ($request.args -isnot [Array] -or $request.args.Count -gt 1024) { throw 'Bounded argument array required.' }
			$arguments = @(); foreach ($argument in $request.args) { if ($argument -isnot [string] -or $argument.IndexOf([char]0) -ge 0) { throw 'Invalid command argument.' }; $arguments += $argument }
			$directory = [Soundscaper.Qualification.Win32.Native]::CanonicalDirectory((Require-String $request.directory))
			$id = Require-String $request.id 80
			$ownerFile = [Soundscaper.Qualification.Win32.Native]::CustodyFile($directory,$id,'.owner.json')
			$closureFile = [Soundscaper.Qualification.Win32.Native]::CustodyFile($directory,$id,'.closure.json')
			if (-not [string]::Equals([IO.Path]::GetFullPath((Require-String $request.ownerFile)),$ownerFile,[StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals([IO.Path]::GetFullPath((Require-String $request.closureFile)),$closureFile,[StringComparison]::OrdinalIgnoreCase)) { throw 'Incorrect owner/closure filenames.' }
			if ([IO.File]::Exists($ownerFile) -or [IO.File]::Exists($closureFile)) { throw 'Exclusive owner/closure files already exist.' }
			$runClosure = $closureFile
			$maximum = 65536
			if (@($request.PSObject.Properties.Name) -ccontains 'maximumOutputBytes') { $maximum = Require-Integer $request.maximumOutputBytes 1 2097152 }
			$result = [Soundscaper.Qualification.Win32.ProcessHost]::Run((Require-String $request.executable),[string[]]$arguments,(Require-String $request.cwd),$directory,$id,(Require-Integer $request.timeoutMs 1 21600000),$ownerFile,$closureFile,$maximum)
			$physical = $result.ownershipResolved -and $result.stdoutClosed -and $result.stderrClosed
			$remaining = @($result.survivorsAfterCleanup)
			if (-not $result.ownershipResolved -and $remaining.Count -eq 0) { $remaining = 1 }
			$failure = $null; if (-not $result.naturalClosure) { $failure = $result.outcome + ': ' + ($result.errors -join '; ') }
			$exit = $result.childExitCode; if ($null -eq $exit) { $exit = $result.controllerExitCode }
			$closure = [pscustomobject]@{ schemaVersion=1; platform='win32'; physicalClosed=[bool]$physical; exitCode=$exit; timedOut=[bool]$result.timedOut; failure=$failure; remainingOwned=$remaining; details=$result }
			[Soundscaper.Qualification.Win32.Native]::WriteExclusive($closureFile,((ConvertTo-Json -InputObject $closure -Depth 16 -Compress)+"`n"))
			$closureWritten = $true
			exit $result.controllerExitCode
		}
		default { throw 'Unknown qualification action.' }
	}
	exit 0
} catch {
	$message = $_.Exception.Message
	if ($null -ne $runClosure -and -not $closureWritten) {
		try {
			$fallback = [pscustomobject]@{ schemaVersion=1; platform='win32'; physicalClosed=$false; exitCode=125; timedOut=$false; failure=('Controller failure: '+$message); remainingOwned=1 }
			[Soundscaper.Qualification.Win32.Native]::WriteExclusive($runClosure,((ConvertTo-Json -InputObject $fallback -Depth 8 -Compress)+"`n"))
		} catch { [Console]::Error.WriteLine('Exclusive failure receipt could not be written.') }
	}
	[Console]::Error.WriteLine($message)
	exit 125
}
