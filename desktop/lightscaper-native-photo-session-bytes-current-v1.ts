/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const BACKING = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const FIXED = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = Uint8Array.prototype.set;
export function copyLightscaperNativePhotoSessionBytesCurrentV1(value: unknown): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('Native Session chunks require genuine Uint8Array bytes.');
	const length = Reflect.apply(LENGTH, value, []) as number, backing = Reflect.apply(BACKING, value, []) as ArrayBuffer;
	if (length < 1 || length > 1_048_576 || Reflect.apply(FIXED, backing, []) !== false) throw new RangeError('Native Session chunks require bounded fixed native backing.');
	const result = new Uint8Array(length); Reflect.apply(SET, result, [value]); return result;
}
export function lightscaperNativePhotoSessionByteReaderCurrentV1(bytes: Uint8Array, release: () => Promise<void>) {
	let closed = false, reading = false, closing: Promise<void> | undefined;
	return Object.freeze({ async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
		if (closed || reading || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 1_048_576 || offset + length > bytes.byteLength) throw new RangeError('Native Session body range is invalid or retired.');
		reading = true; try { return await Promise.resolve(new Uint8Array(bytes.subarray(offset, offset + length))); } finally { reading = false; }
	}, close(): Promise<void> { if (closing) return closing; closed = true; closing = release(); return closing; } });
}
export async function hashLightscaperNativePhotoSessionBlobCurrentV1(body: Blob): Promise<string> {
	const hash = createHash('sha256');
	for (let offset = 0; offset < body.size; offset += 1_048_576) { const bytes = new Uint8Array(await body.slice(offset, offset + 1_048_576).arrayBuffer()); try { hash.update(bytes); } finally { bytes.fill(0); } }
	return hash.digest('hex');
}
