/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

interface PackageFile {
	readonly name: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export async function verifyAuditedPackageFiles(directory: string, files: readonly PackageFile[]): Promise<void> {
	const names = files.map(({ name }) => name).sort();
	const entries = await readdir(directory, { withFileTypes: true });
	if (!isDeepStrictEqual(entries.map(({ name }) => name).sort(), names)
		|| entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
		throw new Error(`Downloaded package inventory differs from its audit: ${directory}`);
	}
	for (const { name, byteLength, sha256 } of files) {
		const path = resolve(directory, name);
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== byteLength) {
			throw new Error(`Downloaded package is not the audited regular file: ${name}`);
		}
		const file = await open(path, 'r');
		try {
			const before = await file.stat();
			const hash = createHash('sha256');
			let bytesRead = 0;
			for await (const chunk of file.createReadStream({ autoClose: false, end: byteLength - 1 })) {
				hash.update(chunk);
				bytesRead += chunk.length;
			}
			const after = await lstat(path);
			if (!sameFile(entry, before) || !sameFile(before, after)
				|| bytesRead !== byteLength || hash.digest('hex') !== sha256) {
				throw new Error(`Downloaded package bytes differ from the audit: ${name}`);
			}
		} finally {
			await file.close();
		}
	}
}

function sameFile(before: Stats, after: Stats): boolean {
	return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size
		&& before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
