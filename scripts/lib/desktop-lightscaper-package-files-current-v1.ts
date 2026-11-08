/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export interface LightscaperPackageFileCurrentV1 {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}
export const LIGHTSCAPER_PACKAGE_MAX_FILE_BYTES_CURRENT_V1 = 128 * 1024 ** 2;
const MAX_FILES = 10_000, MAX_TOTAL_BYTES = 512 * 1024 ** 2;

export function lightscaperAbsoluteRootCurrentV1(value: string): string {
	if (typeof value !== 'string' || !value || !isAbsolute(value) || value.includes('\0')) {
		throw new TypeError('Lightscaper package root must be an absolute path.');
	}
	return resolve(value);
}
export function lightscaperRelativePathCurrentV1(value: unknown): string {
	if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || /[\\:]/u.test(value)
		|| [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		|| value.split('/').some(part => !part || part === '.' || part === '..') || isAbsolute(value)) {
		throw new TypeError('Lightscaper package member path is invalid.');
	}
	return value;
}

/** Capture regular files; only an explicitly selected Electron locale root may be empty. */
export async function captureLightscaperPackageFilesCurrentV1(rootValue: string, allowEmptyRoot = false): Promise<readonly LightscaperPackageFileCurrentV1[]> {
	const root = lightscaperAbsoluteRootCurrentV1(rootValue), metadata = await lstat(root);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Lightscaper package tree must be a regular directory.');
	const canonical = await realpath(root), files: LightscaperPackageFileCurrentV1[] = [];
	const folded = new Set<string>(); let total = 0, entries = 0;
	async function visit(directory: string): Promise<void> {
		const children = await readdir(directory, { withFileTypes: true });
		if (!children.length && !(allowEmptyRoot && directory === canonical)) throw new Error('Lightscaper package tree contains an empty directory.');
		for (const child of children) {
			if (++entries > MAX_FILES * 2) throw new RangeError('Lightscaper package inventory exceeds its entry bound.');
			const path = join(directory, child.name), name = lightscaperRelativePathCurrentV1(relative(canonical, path).split(sep).join('/'));
			const caseFolded = name.toLowerCase();
			if (folded.has(caseFolded)) throw new Error('Lightscaper package paths collide on maintained targets.');
			folded.add(caseFolded);
			const stat = await lstat(path);
			if (stat.isDirectory() && !stat.isSymbolicLink()) { assertContained(canonical, await realpath(path)); await visit(path); }
			else if (stat.isFile() && !stat.isSymbolicLink()) {
				if (files.length >= MAX_FILES) throw new RangeError('Lightscaper package inventory exceeds its file bound.');
				const bytes = await readLightscaperPackageFileCurrentV1(canonical, name);
				total += bytes.length;
				if (total > MAX_TOTAL_BYTES) throw new RangeError('Lightscaper package inventory exceeds its byte bound.');
				files.push(Object.freeze({ path: name, byteLength: bytes.length, sha256: lightscaperPackageDigestCurrentV1(bytes) }));
			} else throw new Error('Lightscaper package trees may not contain links or special files.');
		}
	}
	await visit(canonical);
	return Object.freeze(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function readLightscaperPackageFileCurrentV1(rootValue: string, nameValue: string,
	maximum = LIGHTSCAPER_PACKAGE_MAX_FILE_BYTES_CURRENT_V1): Promise<Buffer> {
	const root = await realpath(lightscaperAbsoluteRootCurrentV1(rootValue)), name = lightscaperRelativePathCurrentV1(nameValue);
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > LIGHTSCAPER_PACKAGE_MAX_FILE_BYTES_CURRENT_V1) {
		throw new RangeError('Lightscaper package read bound is invalid.');
	}
	const path = resolve(root, name); assertContained(root, path);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) {
		throw new Error('Lightscaper package member is not a bounded regular file.');
	}
	assertContained(root, await realpath(path));
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino) {
			throw new Error('Lightscaper package file changed while opening.');
		}
		const bytes = Buffer.alloc(opened.size); let offset = 0;
		while (offset < bytes.length) {
			const part = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (!part.bytesRead) throw new Error('Lightscaper package file was truncated.');
			offset += part.bytesRead;
		}
		const extra = Buffer.alloc(1), after = await handle.stat();
		if ((await handle.read(extra, 0, 1, offset)).bytesRead || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
			throw new Error('Lightscaper package file changed during authentication.');
		}
		assertContained(root, await realpath(path));
		return bytes;
	} finally { await handle.close(); }
}

export function normalizeLightscaperPackageFilesCurrentV1(value: unknown): readonly LightscaperPackageFileCurrentV1[] {
	if (!Array.isArray(value) || !value.length || value.length > MAX_FILES || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Lightscaper package inventory must be a bounded dense array.');
	}
	let total = 0, previous = '';
	const folded = new Set<string>();
	return Object.freeze(value.map((item: unknown) => {
		const row = lightscaperClosedRecordCurrentV1(item, ['path', 'byteLength', 'sha256']);
		const path = lightscaperRelativePathCurrentV1(row.path);
		if (path <= previous || folded.has(path.toLowerCase())) throw new Error('Lightscaper package inventory is not sorted and unique.');
		previous = path; folded.add(path.toLowerCase());
		const byteLength = row.byteLength, sha256 = row.sha256;
		if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1
			|| byteLength > LIGHTSCAPER_PACKAGE_MAX_FILE_BYTES_CURRENT_V1 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
			throw new TypeError('Lightscaper package file pin is invalid.');
		}
		total += byteLength;
		if (total > MAX_TOTAL_BYTES) throw new RangeError('Lightscaper package inventory exceeds its byte bound.');
		return Object.freeze({ path, byteLength, sha256 });
	}));
}
export function assertLightscaperPackageEqualCurrentV1(actual: unknown, expected: unknown, label: string): void {
	if (!isDeepStrictEqual(actual, expected)) throw new Error(`Lightscaper ${label} differs from its captured authority.`);
}
export function lightscaperClosedRecordCurrentV1(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Lightscaper package metadata must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Lightscaper package metadata has missing or extra fields.');
	}
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Lightscaper package metadata requires data fields.');
		result[field] = descriptor.value as unknown;
	}
	return result;
}
export function lightscaperPackageDigestCurrentV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function assertContained(root: string, path: string): void {
	const name = relative(root, path);
	if (!name || name === '..' || name.startsWith(`..${sep}`) || isAbsolute(name)) throw new Error('Lightscaper package member leaves its owned tree.');
}
