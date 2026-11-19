/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProjectFileName } from '../src/common/project-file-extensions.ts';

export const LIGHTSCAPER_ARCHIVE_OPEN_MAXIMUM_PENDING_CURRENT_V1 = 16;
const BOOLEAN_FLAGS = new Set(['--no-sandbox', '--disable-gpu', '--enable-logging', '--disable-dev-shm-usage',
	'--no-first-run', '--disable-software-rasterizer', '--in-process-gpu', '--version', '--help', '-v', '-h']);

/** Main-only native inputs. Values following non-boolean flags are not treated
 * as positional files; paired qualification flags never become file authority.
 * An explicit -- marks literal positional names. No URL scheme except a plain
 * local file URL is interpreted as a path. */
export function extractLightscaperArchiveOpenPathsCurrentV1(argv: readonly unknown[], workingDirectory: string): readonly string[] {
	if (!isAbsolute(workingDirectory) || workingDirectory.includes('\0')) throw new TypeError('Archive argv requires its native absolute working directory.');
	const paths: string[] = [], keys = new Set<string>(); let positionalOnly = false;
	for (let index = 0; index < argv.length && paths.length < LIGHTSCAPER_ARCHIVE_OPEN_MAXIMUM_PENDING_CURRENT_V1; index++) {
		const argument = argv[index];
		if (typeof argument !== 'string' || !argument || argument.length > 32_768 || argument.includes('\0')) continue;
		if (!positionalOnly && argument === '--') { positionalOnly = true; continue; }
		if (!positionalOnly && argument.startsWith('-')) {
			if (!argument.includes('=') && !BOOLEAN_FLAGS.has(argument)) index++;
			continue;
		}
		let candidate = argument;
		if (candidate.startsWith('file:')) {
			try {
				const url = new URL(candidate);
				if (url.protocol !== 'file:' || url.username || url.password || url.search || url.hash) continue;
				candidate = fileURLToPath(url);
			} catch { continue; }
		} else if (/^[a-z][a-z0-9+.-]*:/iu.test(candidate) && !/^[a-z]:[\\/]/iu.test(candidate)) continue;
		const path = normalizeLightscaperArchiveOpenNativePathCurrentV1(resolve(workingDirectory, candidate));
		if (!path) continue;
		const key = lightscaperArchiveOpenPathKeyCurrentV1(path);
		if (!keys.has(key)) { keys.add(key); paths.push(path); }
	}
	return Object.freeze(paths);
}
export function normalizeLightscaperArchiveOpenNativePathCurrentV1(value: unknown): string | null {
	if (typeof value !== 'string' || !value || value.length > 32_768 || value.includes('\0') || !isAbsolute(value) || !isProjectFileName(value)) return null;
	return normalize(value);
}
export function lightscaperArchiveOpenPathKeyCurrentV1(path: string): string {
	return process.platform === 'win32' ? path.toLowerCase() : path;
}
