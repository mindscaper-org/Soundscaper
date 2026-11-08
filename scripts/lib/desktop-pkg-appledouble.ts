/* SPDX-License-Identifier: AGPL-3.0-only */

/** Normalize the signing xattrs that Apple's CPIO reader restores as metadata. */
import type { Stats } from 'node:fs';
import { lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';

const MAXIMUM_SIDECAR_BYTES = 1024 * 1024;
const SIGNING_ATTRIBUTES = new Set([
	'com.apple.cs.CodeDirectory', 'com.apple.cs.CodeRequirements',
	'com.apple.cs.CodeRequirements-1', 'com.apple.cs.CodeSignature',
]);

export async function removePkgCodeSignatureSidecars(payloadRoot: string, names: readonly string[]): Promise<void> {
	for (const name of names) {
		try {
			if (posix.isAbsolute(name) || posix.normalize(name) !== name || name.startsWith('../')
				|| name.includes('\\') || !basename(name).startsWith('._') || basename(name).length < 3) fail();
			const path = resolve(payloadRoot, name);
			const target = join(dirname(path), basename(path).slice(2));
			await regularFile(target);
			const metadata = await regularFile(path);
			if (metadata.size > MAXIMUM_SIDECAR_BYTES) fail();
			const bytes = await readFile(path);
			if (bytes.length !== metadata.size) fail();
			validateSigningSidecar(bytes);
			await unlink(path);
		} catch (error) {
			throw new Error(`The PKG AppleDouble signing metadata is invalid: ${name}.`, { cause: error });
		}
	}
}

function validateSigningSidecar(bytes: Buffer): void {
	// Exactly FinderInfo/xattrs and an empty resource fork: no application data may be discarded.
	if (bytes.length < 120 || bytes.readUInt32BE(0) !== 0x00051607
		|| bytes.readUInt32BE(4) !== 0x00020000 || bytes.toString('ascii', 8, 24) !== 'Mac OS X        '
		|| bytes.readUInt16BE(24) !== 2 || bytes.readUInt32BE(26) !== 9
		|| bytes.readUInt32BE(30) !== 50 || bytes.readUInt32BE(34) !== bytes.length - 50
		|| bytes.readUInt32BE(38) !== 2 || bytes.readUInt32BE(42) !== bytes.length
		|| bytes.readUInt32BE(46) !== 0 || bytes.subarray(50, 84).some(byte => byte !== 0)
		|| bytes.toString('ascii', 84, 88) !== 'ATTR' || bytes.readUInt32BE(88) !== 0
		|| bytes.readUInt32BE(92) !== bytes.length || bytes.subarray(104, 118).some(byte => byte !== 0)) fail();
	const dataStart = bytes.readUInt32BE(96);
	const count = bytes.readUInt16BE(118);
	if (dataStart < 120 || dataStart > bytes.length || dataStart + bytes.readUInt32BE(100) !== bytes.length
		|| count < 1 || count > SIGNING_ATTRIBUTES.size) fail();
	let entry = 120;
	let valueOffset = dataStart;
	const names = new Set<string>();
	for (let index = 0; index < count; index += 1) {
		if (entry + 11 > dataStart) fail();
		const offset = bytes.readUInt32BE(entry);
		const length = bytes.readUInt32BE(entry + 4);
		const nameLength = bytes[entry + 10];
		const nameEnd = entry + 11 + nameLength;
		if (nameLength < 2 || nameEnd > dataStart || bytes[nameEnd - 1] !== 0
			|| bytes.readUInt16BE(entry + 8) !== 0 || offset !== valueOffset
			|| length < 1 || offset + length > bytes.length) fail();
		const name = bytes.toString('utf8', entry + 11, nameEnd - 1);
		if (!SIGNING_ATTRIBUTES.has(name) || names.has(name)) fail();
		names.add(name);
		entry = (nameEnd + 3) & ~3;
		if (entry > dataStart || bytes.subarray(nameEnd, entry).some(byte => byte !== 0)) fail();
		valueOffset += length;
	}
	if (valueOffset !== bytes.length || bytes.subarray(entry, dataStart).some(byte => byte !== 0)) fail();
}

async function regularFile(path: string): Promise<Stats> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1
		|| await realpath(path) !== path || await realpath(dirname(path)) !== dirname(path)) fail();
	return metadata;
}

function fail(): never {
	throw new Error('Expected a regular file with only bounded AppleDouble code-signing attributes.');
}
