/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Durable plug-in settings must outlive the process, so they are written
 * atomically. A half-written record would be indistinguishable from a machine
 * on which nothing was ever quarantined or consented to, which is the exact
 * state these stores exist to prevent.
 */
export function createDurableFileSystem() {
	return Object.freeze({
		readFile: (path) => readFile(path, 'utf8'),
		writeFile: async (path, contents) => {
			await mkdir(dirname(path), { recursive: true });
			const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
			await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
			await rename(temporary, path);
		},
	});
}
