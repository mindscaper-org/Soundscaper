# SPDX-License-Identifier: AGPL-3.0-only
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$script:visited = 0
function Read-AssociationTree([Microsoft.Win32.RegistryKey] $key, [int] $depth) {
	$script:visited += 1
	if ($depth -gt 6 -or $script:visited -gt 128) { throw 'Association registry snapshot exceeds its bounded tree.' }
	[string[]] $valueNames = $key.GetValueNames()
	[string[]] $childNames = $key.GetSubKeyNames()
	[Array]::Sort($valueNames, [StringComparer]::Ordinal)
	[Array]::Sort($childNames, [StringComparer]::Ordinal)
	$values = @()
	foreach ($name in $valueNames) {
		if ($name.Length -gt 256) { throw 'Association registry value name exceeds its bound.' }
		$kind = $key.GetValueKind($name).ToString()
		$value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
		switch ($kind) {
			'Binary' { $value = [Convert]::ToBase64String($value) }
			'None' { $value = [Convert]::ToBase64String($value) }
			'QWord' { $value = $value.ToString([Globalization.CultureInfo]::InvariantCulture) }
			'DWord' { $value = $value.ToString([Globalization.CultureInfo]::InvariantCulture) }
			'String' { }
			'ExpandString' { }
			'MultiString' { }
			default { throw 'Unknown association registry value kind.' }
		}
		$values += [ordered]@{ name = $name; kind = $kind; value = $value }
	}
	$children = @()
	foreach ($name in $childNames) {
		if ($name.Length -gt 256) { throw 'Association registry child name exceeds its bound.' }
		$child = $key.OpenSubKey($name, $false)
		if ($null -eq $child) { throw 'Association registry changed during its bounded snapshot.' }
		try { $children += [ordered]@{ name = $name; tree = (Read-AssociationTree $child ($depth + 1)) } }
		finally { $child.Dispose() }
	}
	return [ordered]@{ values = $values; children = $children }
}
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
try {
	$paths = @()
	foreach ($suffix in @('.liscape', '.sscape', '.fscape', '.scape')) {
		$paths += "Software\Classes\$suffix"
		$paths += "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$suffix\UserChoice"
	}
	$paths += 'Software\Classes\Lightscaper Catalog'
	$rows = @()
	foreach ($path in $paths) {
		$key = $base.OpenSubKey($path, $false)
		if ($null -eq $key) { $rows += [ordered]@{ path = $path; state = 'absent'; tree = $null }; continue }
		try { $rows += [ordered]@{ path = $path; state = 'present'; tree = (Read-AssociationTree $key 0) } }
		finally { $key.Dispose() }
	}
	$json = [ordered]@{ schemaVersion = 1; hive = 'HKEY_CURRENT_USER'; view = 'Registry64'; keys = $rows } | ConvertTo-Json -Depth 24 -Compress
	if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 16384) { throw 'Association registry snapshot exceeds its byte bound.' }
	[Console]::Out.WriteLine($json)
} finally { $base.Dispose() }
