/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { win32 } from 'node:path';

interface VolumeProbe {
	readonly platform?: NodeJS.Platform;
	readonly environment?: NodeJS.ProcessEnv;
	readonly filesystemType?: (path: string) => number;
	readonly run?: (file: string, args: readonly string[], environment: NodeJS.ProcessEnv) => string;
}

// Linux uapi/linux/magic.h plus OpenZFS's ZFS_SUPER_MAGIC. Unknown, network,
// clustered and FUSE filesystems cannot establish safe local database storage.
const LOCAL_LINUX_TYPES = new Set([
	0xef53, 0x58465342, 0x9123683e, 0xf2f52010, 0x3434, 0xca451a4e,
	0x2fc12fc1, 0x5346544e, 0x4d44, 0x2011bab0, 0x01021994, 0x858458f6,
]);
const WINDOWS_PROBE = [
	'$ErrorActionPreference = "Stop";',
	'$root = [System.IO.Path]::GetPathRoot($env:SOUNDSCAPER_STORAGE_PROBE_PATH);',
	'$kind = ([System.IO.DriveInfo]::new($root)).DriveType;',
	'if ($kind -eq "Fixed" -or $kind -eq "Removable" -or $kind -eq "Ram") { "local" } else { "remote" }',
].join(' ');
const MACOS_PROBE = [
	'ObjC.import("Foundation");',
	'var path = $.NSProcessInfo.processInfo.environment.objectForKey("SOUNDSCAPER_STORAGE_PROBE_PATH");',
	'var url = $.NSURL.fileURLWithPath(path); var value = Ref(); var error = Ref();',
	'if (!url.getResourceValueForKeyError(value, $.NSURLVolumeIsLocalKey, error)) throw Error("Cannot inspect storage volume");',
	'value[0].boolValue ? "local" : "remote";',
].join(' ');

/** Positive locality admission; probe errors propagate instead of admitting an unknown mount. */
export function isLocalDesktopVolume(path: string, probe: VolumeProbe = {}): boolean {
	const platform = probe.platform ?? process.platform;
	if (platform === 'linux') {
		const type = probe.filesystemType ? probe.filesystemType(path) : statfsSync(path).type;
		return LOCAL_LINUX_TYPES.has(type >>> 0);
	}
	const environment: NodeJS.ProcessEnv = { ...(probe.environment ?? process.env), SOUNDSCAPER_STORAGE_PROBE_PATH: path };
	const run = probe.run ?? runProbe;
	if (platform === 'win32') {
		const executable = win32.join(environment.SystemRoot ?? 'C:\\Windows',
			'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
		return run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROBE], environment).trim() === 'local';
	}
	if (platform === 'darwin') {
		return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MACOS_PROBE], environment).trim() === 'local';
	}
	return false;
}

function runProbe(file: string, args: readonly string[], environment: NodeJS.ProcessEnv): string {
	return execFileSync(file, args, {
		env: environment, encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
		windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
	});
}
