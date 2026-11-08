/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { debugCheckCurrentV1 } from './photo-library-debug-soak-contract-current-v1.ts';
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice, READ = Blob.prototype.arrayBuffer;
export const debugHashCurrentV1 = (bytes: Uint8Array<ArrayBuffer>): string => bytesToHex(sha256(bytes));
export async function hashDebugBlobCurrentV1(blob: Blob, signal?: AbortSignal): Promise<Readonly<{ sha256: string; byteLength: number }>> {
	const size = Number(Reflect.apply(SIZE, blob, [])); if (!Number.isSafeInteger(size) || size < 1 || size > 64 * 1024 * 1024) throw new RangeError('Diagnostic body exceeds its bounded encoded profile.');
	const hash = sha256.create();
	try { for (let offset = 0; offset < size; offset += 1024 * 1024) {
		debugCheckCurrentV1(signal); const part = Reflect.apply(SLICE, blob, [offset, Math.min(size, offset + 1024 * 1024)]) as Blob;
		const bytes = new Uint8Array(await Reflect.apply(READ, part, []) as ArrayBuffer);
		try { debugCheckCurrentV1(signal); hash.update(bytes); } finally { bytes.fill(0); }
	} return Object.freeze({ sha256: bytesToHex(hash.digest()), byteLength: size }); } finally { hash.destroy(); }
}
