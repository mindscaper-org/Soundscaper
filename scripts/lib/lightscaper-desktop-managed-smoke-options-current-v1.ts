/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';

export interface LightscaperManagedSmokeOptionsCurrentV1 {
	readonly backend: 'web' | 'native';
	readonly scenario: 'managed' | 'linked';
	readonly executable: string; readonly runtimeRoot: string; readonly outputRoot: string;
	readonly allowNoSandbox: boolean; readonly windowsJobHelper: string | null;
	readonly windowsJobHelperSha256: string | null;
}

/** Parsing grants no launch authority. Native helper admission, including
	* current-host PE and full digest checks, must happen before profile creation. */
export function readLightscaperManagedSmokeOptionsCurrentV1(args: readonly string[], platform: string = process.platform): LightscaperManagedSmokeOptionsCurrentV1 {
	const paths = new Set(['--executable', '--runtime-root', '--output-root', '--windows-job-helper']);
	const values = new Map<string, string>(); let allowNoSandbox = false;
	for (let at = 0; at < args.length; at++) {
		const name = args[at]!;
		if (name === '--allow-no-sandbox') {
			if (allowNoSandbox) throw new Error('Duplicate no-sandbox option.');
			allowNoSandbox = true; continue;
		}
		if ((!paths.has(name) && name !== '--windows-job-helper-sha256' && name !== '--backend' && name !== '--scenario') || values.has(name)) throw new Error(`Unknown or duplicate smoke option ${name}.`);
		const value = args[++at];
		if (!value || value.includes('\0')) throw new Error('Smoke option value is missing or invalid.');
		if (name === '--scenario') {
			if (value !== 'managed' && value !== 'linked') throw new Error('Photo smoke scenario must be managed or linked.');values.set(name,value);
		} else if (name === '--backend') {
			if (value !== 'web' && value !== 'native') throw new Error('Managed smoke backend must be web or native.');
			values.set(name, value);
		} else if (name === '--windows-job-helper-sha256') {
			if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('Windows Job helper SHA-256 must be explicit lower-case hexadecimal.');
			values.set(name, value);
		} else {
			if (!isAbsolute(value)) throw new Error('Smoke paths must be explicit absolute paths.');
			values.set(name, resolve(value));
		}
	}
	const executable = values.get('--executable'), runtimeRoot = values.get('--runtime-root'), outputRoot = values.get('--output-root');
	if (!executable || !runtimeRoot || !outputRoot) throw new Error('Managed smoke requires --executable, --runtime-root and --output-root absolute paths.');
	const windowsJobHelper = values.get('--windows-job-helper') ?? null, windowsJobHelperSha256 = values.get('--windows-job-helper-sha256') ?? null;
	if (platform === 'win32') {
		if (!windowsJobHelper || !windowsJobHelperSha256) throw new Error('Windows managed smoke requires paired explicit --windows-job-helper and --windows-job-helper-sha256.');
	} else if (windowsJobHelper || windowsJobHelperSha256) throw new Error('Windows Job helper options require a Windows Node host.');
	if(values.get('--scenario')==='linked'&&values.get('--backend')!=='native')throw new Error('Linked smoke requires explicit native backend.');
	return Object.freeze({ scenario:values.get('--scenario')==='linked'?'linked':'managed', backend: values.get('--backend') === 'native' ? 'native' : 'web', executable, runtimeRoot, outputRoot, allowNoSandbox, windowsJobHelper, windowsJobHelperSha256 });
}
