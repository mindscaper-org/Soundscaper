/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaAssetWriteOptions, MediaAssetWriter } from '../../src/common/editor/storage/media-asset-write-contract.ts';
import type { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { rawDngFixtureV1 } from './lightscaper-raw-dng-current-fixture.ts';
import { deferred } from './async-test-control.ts';
export { managedMediaIntegrationFixtureCurrentV1 as nativeWriterFixtureCurrentV1,
	managedMediaIntegrationReadCurrentV1 as readNativeWriterOriginalCurrentV1,
	managedMediaIntegrationReferenceCurrentV1 as nativeWriterReferenceCurrentV1,
	managedMediaIntegrationExactFailureCurrentV1 as exactNativeWriterFailureCurrentV1,
	observeManagedMediaIntegrationCommitCurrentV1 as observeNativeWriterCommitCurrentV1,
	MANAGED_MEDIA_CATALOG_CURRENT_V1 as NATIVE_WRITER_CATALOG_CURRENT_V1 } from './lightscaper-native-managed-media-integration-fixture-current.ts';

export const NATIVE_WRITER_CHUNK_CURRENT_V1 = 4 * 1024 * 1024;
export const nativeWriterShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Existing native owner is used directly, including in missing-method RED.
 * Reflect only avoids pretending the new method exists on the E83 TS class. */
export async function beginNativeWriterCurrentV1(media: Media, sourceId: string,
	metadata: unknown, options: Readonly<MediaAssetWriteOptions>): Promise<MediaAssetWriter> {
	const method: unknown = Reflect.get(media, 'beginAssetWrite');
	assert.equal(typeof method, 'function', 'The real native media owner must expose beginAssetWrite.');
	return await Reflect.apply(method as (...args: unknown[]) => Promise<MediaAssetWriter>, media, [sourceId, metadata, options]);
}

/** Genuine owned TIFF/DNG with harmless ignored trailing bytes. This fixture
 * qualifies persistence, digest and custody only; no decoder/pixel claim. */
export function nativeWriterInputCurrentV1(index = 601, length = NATIVE_WRITER_CHUNK_CURRENT_V1 + 137) {
	const dng = rawDngFixtureV1().bytes, bytes = new Uint8Array(Math.max(dng.length, length)); bytes.set(dng);
	for (let offset = dng.length; offset < bytes.length; offset++) bytes[offset] = (offset * 29 + index) & 255;
	const seed = photoArchiveFixture(index, bytes).photo, name = `Owned streamed ${index}.dng`;
	const photo = normalizePhotoDocumentCurrentV1({ ...seed, original: { ...seed.original, name,
		mimeType: 'image/x-adobe-dng', width: 32, height: 32 }, metadata: { ...seed.metadata, fileName: name } });
	return { bytes, photo, original: photo.original, options: { expectedBytes: bytes.length, expectedSha256: nativeWriterShaCurrentV1(bytes) },
		metadata: { name, mimeType: 'image/x-adobe-dng', lastModified: 17 } };
}

export async function writeNativeWriterInputCurrentV1(writer: MediaAssetWriter, bytes: Uint8Array): Promise<void> {
	for (let offset = 0; offset < bytes.length; offset += NATIVE_WRITER_CHUNK_CURRENT_V1) {
		await writer.write(bytes.subarray(offset, Math.min(bytes.length, offset + NATIVE_WRITER_CHUNK_CURRENT_V1)));
	}
}

/** Forward every real native write unchanged, then observe its actual receipt.
 * A held receipt never simulates file bytes or releases a native reader early. */
export async function observeNativeWriterFileWritesCurrentV1<Result>(directory: string,
	after: (length: number) => void | Promise<void>, run: () => Promise<Result>): Promise<Result> {
	const witness = await open(join(directory, 'writer-native-handle-observer'), 'wx');
	const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'write');
	assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['write']; await witness.close();
	Object.defineProperty(prototype, 'write', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
		const result = Reflect.apply(native, this, args) as ReturnType<FileHandle['write']>;
		return result.then(async value => { await after(value.bytesWritten); return value; });
	} });
	try { return await run(); } finally { Object.defineProperty(prototype, 'write', descriptor); }
}

export async function holdNativeWriterFileWriteCurrentV1<Result>(directory: string,
	run: (control: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<Result>): Promise<Result> {
	const entered = deferred<void>(), release = deferred<void>(); let held = false;
	try {
		return await observeNativeWriterFileWritesCurrentV1(directory, async () => {
			if (!held) { held = true; entered.resolve(); await release.promise; }
		}, () => run({ entered: entered.promise, release: () => { release.resolve(); } }));
	} finally { release.resolve(); }
}
