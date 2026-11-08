/* SPDX-License-Identifier: AGPL-3.0-only */

import { Blob, File } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { captureLightscaperNativePhotoMediaMetadataCurrentV1, readLightscaperNativePhotoMediaMetadataCurrentV1 } from './lightscaper-native-photo-media-metadata-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM,
	LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK,
	readLightscaperNativeOriginalStorageKeyCurrentV1 } from './lightscaper-native-original-contract-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';

export { LIGHTSCAPER_NATIVE_PHOTO_MEDIA_RESERVED_METADATA_CURRENT_V1 } from './lightscaper-native-photo-media-metadata-current-v1.ts';

export type LightscaperNativePhotoMediaWriteCurrentV1 = Readonly<object>;
type Captured = {
	readonly assetId: string; readonly blob: Blob; readonly size: number; readonly metadataPayload: Uint8Array;
	binding: Readonly<LightscaperNativeOriginalBindingCurrentV1> | null;
};
const captures = new WeakMap<object, Captured>();
const READ = Blob.prototype.arrayBuffer, SLICE = Blob.prototype.slice;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;
const NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const MODIFIED = Object.getOwnPropertyDescriptor(File.prototype, 'lastModified')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Called after the owner registers this request. Native Blob and metadata
 * snapshots precede the first await; metadata encoding owns no body hash. */
export async function captureLightscaperNativePhotoMediaWriteCurrentV1(
	assetIdValue: string, input: unknown, metadata: unknown = {},
): Promise<LightscaperNativePhotoMediaWriteCurrentV1> {
	const assetId = readLightscaperNativeOriginalStorageKeyCurrentV1(assetIdValue);
	const size: unknown = Reflect.apply(SIZE, input, []), type: unknown = Reflect.apply(TYPE, input, []);
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > MAXIMUM || typeof type !== 'string') {
		throw new RangeError('Native Photo media body leaves its managed Original byte profile.');
	}
	const blob = Reflect.apply(SLICE, input, [0, size, type]) as Blob;
	const captured = await captureLightscaperNativePhotoMediaMetadataCurrentV1(assetId, metadata,
		{ name: String(fileFact(input, NAME, '') || ''), mimeType: type, lastModified: Number(fileFact(input, MODIFIED, 0)) });
	const { metadataPayload } = readLightscaperNativePhotoMediaMetadataCurrentV1(captured);
	const token = Object.freeze({}); captures.set(token, { assetId, blob, size, metadataPayload, binding: null }); return token;
}

/** A digest is derived only from actual immutable native Blob slices. */
export async function digestLightscaperNativePhotoMediaWriteCurrentV1(
	value: LightscaperNativePhotoMediaWriteCurrentV1, signal?: AbortSignal,
): Promise<Readonly<LightscaperNativeOriginalBindingCurrentV1>> {
	const captured = readLightscaperNativePhotoMediaWriteCurrentV1(value); check(signal);
	const hash = createHash('sha256');
	for await (const bytes of emit(captured, signal)) hash.update(bytes);
	check(signal);
	const binding = Object.freeze({ storageKey: captured.assetId, byteLength: captured.size, contentSha256: hash.digest('hex') });
	captured.binding = binding; return binding;
}

/** Second pass feeds the real file owner, with at most one MiB per emission. */
export function lightscaperNativePhotoMediaWriteChunksCurrentV1(
	value: LightscaperNativePhotoMediaWriteCurrentV1, signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
	const captured = readLightscaperNativePhotoMediaWriteCurrentV1(value); check(signal); return emit(captured, signal);
}

/** Main-private brand lookup for the synchronous asset publisher. */
export function readLightscaperNativePhotoMediaWriteCurrentV1(value: unknown): Captured {
	const captured = value !== null && typeof value === 'object' ? captures.get(value) : undefined;
	if (!captured) throw new TypeError('Native Photo media publication requires its genuine captured write.');
	return captured;
}

async function* emit(captured: Captured, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
	for (let offset = 0; offset < captured.size;) {
		check(signal); const length = Math.min(CHUNK, captured.size - offset);
		const part = Reflect.apply(SLICE, captured.blob, [offset, offset + length]) as Blob;
		let backing: unknown;
		try { backing = await Reflect.apply(READ, part, []); } catch (error) { check(signal); throw error; }
		check(signal);
		if (!types.isArrayBuffer(backing) || backing.byteLength !== length) throw new Error('Native Photo media slice differs from its immutable body.');
		offset += length; yield new Uint8Array(backing);
	}
	check(signal);
}
function fileFact(input: unknown, getter: (this: unknown) => unknown, fallback: unknown): unknown {
	try { return Reflect.apply(getter, input, []); } catch { return fallback; }
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
