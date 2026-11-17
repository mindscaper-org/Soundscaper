# SPDX-License-Identifier: AGPL-3.0-only
param(
    [Parameter(Mandatory=$true)][string]$Artifact,
    [Parameter(Mandatory=$true)][string]$CabinetDirectory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$installer = New-Object -ComObject WindowsInstaller.Installer
# Mode 0 opens the database read-only. No installation sequence or custom action runs.
$database = $installer.OpenDatabase($Artifact, 0)
function Read-Rows($sql, $names) {
    $view = $database.OpenView($sql)
    try {
        $view.Execute()
        $rows = [System.Collections.Generic.List[object]]::new()
        while ($null -ne ($record = $view.Fetch())) {
            try {
                if ($rows.Count -ge 100000) { throw 'MSI table exceeds its row limit' }
                $row = @{}
                for ($i = 0; $i -lt $names.Count; $i++) { $row[$names[$i]] = [string]$record.StringData($i + 1) }
                $rows.Add($row)
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
        }
        return ,$rows.ToArray()
    } finally { $view.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
}
try {
    $tables = Read-Rows 'SELECT `Name` FROM `_Tables`' @('name')
    if ($tables.name -contains 'CustomAction') {
        $actions = Read-Rows 'SELECT `Action` FROM `CustomAction`' @('name')
        if ($actions.Count -gt 0) { throw 'Managed MSI packages must not contain custom actions' }
    }
    $files = Read-Rows 'SELECT `File`, `Component_`, `FileName`, `FileSize` FROM `File`' @('id', 'component', 'name', 'size')
    $directories = Read-Rows 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`' @('id', 'parent', 'name')
    $components = Read-Rows 'SELECT `Component`, `Directory_` FROM `Component`' @('id', 'directory')
    $cabinets = Read-Rows 'SELECT `Cabinet` FROM `Media` ORDER BY `DiskId`' @('cabinet')
    if ($cabinets.Count -lt 1 -or $cabinets.Count -gt 256) { throw 'MSI cabinet count is invalid' }
    [void][IO.Directory]::CreateDirectory($CabinetDirectory)
    $index = 0
    $totalBytes = [long]0
    foreach ($cabinet in $cabinets) {
        if ($cabinet.cabinet -notmatch '^#[A-Za-z0-9_.-]+$') { throw 'MSI cabinet must be embedded' }
        $name = $cabinet.cabinet.Substring(1)
        $view = $database.OpenView("SELECT ``Data`` FROM ``_Streams`` WHERE ``Name`` = '$name'")
        try {
            $view.Execute()
            $record = $view.Fetch()
            if ($null -eq $record) { throw 'MSI embedded cabinet is missing' }
            try {
                $output = [IO.File]::Open((Join-Path $CabinetDirectory "cab-$index.cab"), 'CreateNew', 'Write', 'None')
                try {
                    do {
                        # msiReadStreamBytes returns one byte per BSTR character (U+0000-U+00FF).
                        $chunk = [string]$record.ReadStream(1, 1048576, 1)
                        $bytes = [Text.Encoding]::GetEncoding(28591).GetBytes($chunk)
                        $totalBytes += $bytes.Length
                        if ($totalBytes -gt 8GB) { throw 'MSI cabinets exceed their size limit' }
                        $output.Write($bytes, 0, $bytes.Length)
                    } while ($bytes.Length -gt 0)
                } finally { $output.Dispose() }
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
        } finally { $view.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
        $index++
    }
    @{ files = $files; directories = $directories; components = $components; cabinets = $cabinets } | ConvertTo-Json -Compress -Depth 6
} finally {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
}
