/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { hashMotionSustainedFile } from '../scripts/performance/motionscaper-sustained-observation.ts';

/** macOS frameworks use internal version links; retain links without following directory aliases twice. */
export async function motionAuthoredBundleIdentity(directory: string) {
	assert.equal(await realpath(directory), directory);
	const metadata = (value: Awaited<ReturnType<typeof lstat>>) => ({ dev: value.dev, ino: value.ino, mode: value.mode,
		uid: value.uid, gid: value.gid, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });
	const files: string[] = [], links: string[] = [], directories: { path: string; metadata: ReturnType<typeof metadata> }[] = [];
	const visit = async (name: string): Promise<void> => {
		const path = join(directory, name), before = await lstat(path); assert.ok(before.isDirectory());
		directories.push({ path: name, metadata: metadata(before) });
		const entries = await readdir(path, { withFileTypes: true });
		for (const entry of entries) {
			const child = name ? `${name}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(child);
			else if (entry.isSymbolicLink()) links.push(child);
			else { assert.ok(entry.isFile(), 'Bundle contains a special file.'); files.push(child); }
			assert.ok(files.length + links.length + directories.length <= 8192, 'Bundle custody inventory exceeded its bound.');
		}
		assert.deepEqual(metadata(await lstat(path)), metadata(before), 'Bundle directory changed during traversal.');
	};
	await visit('');
	const records = [];
	for (const path of files.sort()) {
		const full = join(directory, path), before = await lstat(full), pin = await hashMotionSustainedFile(full), after = await lstat(full);
		assert.deepEqual(metadata(after), metadata(before)); records.push({ ...pin, path, ...metadata(after) });
	}
	for (const path of links.sort()) {
		const full = join(directory, path), before = await lstat(full), link = await readlink(full), resolved = await realpath(full), descendant = relative(directory, resolved);
		assert.ok(descendant !== '..' && !descendant.startsWith('../') && !isAbsolute(descendant), 'Bundle symlink escape refused.');
		assert.deepEqual(metadata(await lstat(full)), metadata(before)); records.push({ path, link, resolved: descendant, ...metadata(before) });
	}
	for (const row of directories) assert.deepEqual(metadata(await lstat(join(directory, row.path))), row.metadata, 'Bundle membership changed during hashing.');
	return [...records, ...directories].sort((a, b) => a.path.localeCompare(b.path));
}
