/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { PhotoOriginalV1 } from './catalog/types.ts';
import { DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 as LIMITS } from './desktop-photo-original-contract-current-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
/** An alias retains its independent native authority. Even a compatible digest
 * must authenticate the actual bytes from that locator before sharing a File.
 * Only a single private <=1MiB copy exists; no second OPFS stage is created. */
export async function authenticateDesktopPhotoOriginalGroupAliasCurrentV1(original: Readonly<PhotoOriginalV1>,
	pull: (offset: number, length: number) => Promise<unknown>, signal: AbortSignal): Promise<void> {
	const hash = sha256.create();
	try {
		for (let offset = 0; offset < original.byteLength;) {
			Reflect.apply(CHECK, signal, []); const length = Math.min(LIMITS.rangeBytes, original.byteLength - offset);
			const value = await pull(offset, length); Reflect.apply(CHECK, signal, []);
			if (!(value instanceof Uint8Array) || Reflect.apply(BYTE_LENGTH, value, []) !== length) throw new RangeError('Native Original alias pull differs from its exact bounded interval.');
			const bytes = new Uint8Array(length);
			try { Reflect.apply(SET, bytes, [value]); hash.update(bytes); Reflect.apply(CHECK, signal, []); }
			finally { Reflect.apply(FILL, bytes, [0]); }
			offset += length;
		}
		const digest = hash.digest();
		try { if (bytesToHex(digest) !== original.contentSha256) throw new Error('Native Original alias SHA-256 differs from its retained binding.'); }
		finally { Reflect.apply(FILL, digest, [0]); }
		Reflect.apply(CHECK, signal, []);
	} finally { hash.destroy(); }
}
