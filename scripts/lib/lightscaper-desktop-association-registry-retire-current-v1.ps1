# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($args.Count -ne 0 -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Owned association residue retirement requires the ephemeral installer qualifier.' }
# The TS installer owner admits this operation only after actual native
# uninstall, recorded prior absence and an unchanged foreign-key snapshot.
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
try {
	foreach ($path in @('Software\Classes\Lightscaper Catalog', 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.liscape\UserChoice')) {
		$key = $base.OpenSubKey($path, $false)
		if ($null -ne $key) { $key.Dispose(); throw 'Uninstaller did not retire the owned class/UserChoice; no residue is authorized.' }
	}
	$key = $base.OpenSubKey('Software\Classes\.liscape', $false)
	$removed = $false
	if ($null -ne $key) {
		try {
			$values = @($key.GetValueNames()); $children = @($key.GetSubKeyNames())
			if ($values.Count -ne 1 -or $values[0] -ne '' -or $key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or
				$key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -cne 'Lightscaper Catalog' -or
				$children.Count -ne 1 -or $children[0] -cne 'OpenWithProgids') { throw 'Catalog suffix is not the exact own-created NSIS residue.' }
			$openWith = $key.OpenSubKey('OpenWithProgids', $false)
			if ($null -eq $openWith) { throw 'Catalog residue changed during admission.' }
			try { if ($openWith.GetValueNames().Count -ne 0 -or $openWith.GetSubKeyNames().Count -ne 0) { throw 'Catalog residue contains foreign values or children.' } }
			finally { $openWith.Dispose() }
		} finally { $key.Dispose() }
		$base.DeleteSubKeyTree('Software\Classes\.liscape', $false)
		$removed = $true
	}
	$after = $base.OpenSubKey('Software\Classes\.liscape', $false)
	if ($null -ne $after) { $after.Dispose(); throw 'Owned catalog suffix residue did not retire.' }
	[Console]::Out.WriteLine(([ordered]@{ schemaVersion = 1; hive = 'HKEY_CURRENT_USER'; path = 'Software\Classes\.liscape'; ownResidueRemoved = $removed; suffixAbsent = $true } | ConvertTo-Json -Compress))
} finally { $base.Dispose() }
