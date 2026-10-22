/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The nightly's reference tools always use their own relocatable interpreter. */
export function interchangePythonExecutable({ referenceRoot, platform = process.platform, environment = process.env }) {
	const bundled = join(referenceRoot, 'python', 'install', platform === 'win32' ? 'python.exe' : 'bin/python3.12');
	if (existsSync(bundled)) return bundled;
	return environment.SOUNDSCAPER_PYTHON || (platform === 'win32' ? 'python' : 'python3');
}
