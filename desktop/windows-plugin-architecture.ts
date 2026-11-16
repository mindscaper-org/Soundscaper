/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
	canonicalNativeChildFileIdentity, nativeChildFileIdentityFromStat,
	type NativeChildFileIdentity,
} from './native-child-file-identity.ts';

export type WindowsPluginArchitecture = 'ia32' | 'x64' | 'arm64';
const MAXIMUM_HEADER_BYTES = 65_562;

/** Inspect bytes, never execute an architecture probe inside a third-party DLL. */
export function windowsPluginArchitecture(bytes: Uint8Array): WindowsPluginArchitecture {
	const header = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (header.length < 64 || header.toString('ascii', 0, 2) !== 'MZ') {
		throw new TypeError('The Windows plugin PE header is malformed.');
	}
	const offset = header.readUInt32LE(0x3c);
	if (offset < 64 || offset > 65_536 || offset + 26 > header.length
		|| header.toString('binary', offset, offset + 4) !== 'PE\0\0') {
		throw new TypeError('The Windows plugin PE header is malformed.');
	}
	const machine = header.readUInt16LE(offset + 4), magic = header.readUInt16LE(offset + 24);
	if (machine === 0x14c && magic === 0x10b) return 'ia32';
	if (machine === 0x8664 && magic === 0x20b) return 'x64';
	if (machine === 0xaa64 && magic === 0x20b) return 'arm64';
	throw new TypeError('The Windows plugin PE architecture is unsupported or inconsistent.');
}

/** Bind routing to the same inode, length and digest as the main-owned grant. */
export async function readAuthenticatedWindowsPluginArchitecture(path: string, expected: Readonly<{
	identity: Readonly<NativeChildFileIdentity>; byteLength: number; sha256: string;
}>): Promise<WindowsPluginArchitecture> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat({ bigint: true });
		const actual = nativeChildFileIdentityFromStat(before);
		const identity = canonicalNativeChildFileIdentity(expected.identity);
		if (!before.isFile() || actual.dev !== identity.dev || actual.ino !== identity.ino
			|| before.size !== BigInt(expected.byteLength)) throw new Error('The plugin changed before architecture authentication.');
		const header = Buffer.alloc(Math.min(expected.byteLength, MAXIMUM_HEADER_BYTES));
		const buffer = Buffer.alloc(1024 ** 2), hash = createHash('sha256');
		let offset = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expected.byteLength - offset + 1), null);
			if (bytesRead === 0) break;
			if (offset + bytesRead > expected.byteLength) throw new Error('The plugin changed during architecture authentication.');
			if (offset < header.length) buffer.copy(header, offset, 0, Math.min(bytesRead, header.length - offset));
			hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		if (offset !== expected.byteLength || hash.digest('hex') !== expected.sha256
			|| before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size) {
			throw new Error('The plugin changed during architecture authentication.');
		}
		return windowsPluginArchitecture(header);
	} finally { await handle.close(); }
}
