/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { LightscaperNativePhotoOriginalReadRequestCurrentV1 as Request } from './lightscaper-native-photo-original-read-authority-current-v1.ts';
import { readLightscaperNativePhotoMediaRestoreMetadataCurrentV1 as readMetadata } from './lightscaper-native-photo-media-restore-payload-current-v1.ts';
import { hashLightscaperNativePhotoMediaRestoreBodyCurrentV1 as hashBody } from './lightscaper-native-photo-media-restore-body-current-v1.ts';
import type { MediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import { field, record } from '../src/lightscaper/catalog/value-validation.ts';
import { photoPackByteView } from '../src/lightscaper/archive/pack-byte-chunk.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
export interface LightscaperNativePhotoMediaRestoreOriginalReceiptCurrentV1 {
	readonly photoId: string; readonly assetId: string; readonly sha256: string; readonly size: number; readonly reused: boolean;
}
export interface LightscaperNativePhotoMediaRestoreOriginalInputCurrentV1 {
	readonly photo: PhotoDocumentCurrentV1;
	readonly iterator: AsyncIterator<Uint8Array>;
}
/** Called only by the registered serial stage admission, before its first await. */
export function captureLightscaperNativePhotoMediaRestoreOriginalCurrentV1(photo: PhotoDocumentCurrentV1, source: AsyncIterable<Uint8Array>): LightscaperNativePhotoMediaRestoreOriginalInputCurrentV1 {
	const iterate = source?.[Symbol.asyncIterator];
	if (typeof iterate !== 'function') throw new TypeError('Native restore Original requires a byte iterator.');
	const iterator = Reflect.apply(iterate, source, []) as AsyncIterator<Uint8Array>, next = iterator.next, leave = iterator.return;
	if (typeof next !== 'function' || leave !== undefined && typeof leave !== 'function') throw new TypeError('Native restore byte iterator is incomplete.');
	return Object.freeze({ photo, iterator: Object.freeze({ next: () => Reflect.apply(next, iterator, []) as ReturnType<typeof next>,
		...(leave === undefined ? {} : { return: () => Reflect.apply(leave, iterator, []) as ReturnType<NonNullable<typeof leave>> }) }) });
}

/** Every alias drains and hashes its own framed source. A reused locator is
 * authenticated only inside the actual fresh generation; no active dedup is consulted. */
export async function writeLightscaperNativePhotoMediaRestoreOriginalCurrentV1(
	input: LightscaperNativePhotoMediaRestoreOriginalInputCurrentV1, media: Media, database: DatabaseSync, importId: string, signal: AbortSignal, previousRequest: Readonly<Request> | undefined,
	writerChanged: (writer: MediaAssetWriter | null) => void, unretired: (iterator: AsyncIterator<Uint8Array>, error: unknown) => void,
): Promise<Readonly<LightscaperNativePhotoMediaRestoreOriginalReceiptCurrentV1>> {
	const { photo, iterator } = input, original = photo.original;
	let writer: MediaAssetWriter | undefined, done = false, committed = false, failed = false, primary: unknown;
	const cleanup: unknown[] = []; let receipt: Readonly<LightscaperNativePhotoMediaRestoreOriginalReceiptCurrentV1> | undefined;
	try {
		check(signal); const exists = database.prepare('SELECT 1 AS present FROM native_photo_media_assets WHERE source_id=?').get(original.storageKey) !== undefined;
		if (exists !== (previousRequest !== undefined)) throw new Error('Native restore locator lacks its own candidate-local delivery authority.');
		if (previousRequest) {
			readMetadata(database, original); await hashBody(media, previousRequest, signal); check(signal);
		} else {
			writer = await media.beginAssetWrite(original.storageKey, { name: original.name, mimeType: original.mimeType },
				{ expectedBytes: original.byteLength, expectedSha256: original.contentSha256, signal }); writerChanged(writer); check(signal);
		}
		const hash = createHash('sha256'); let length = 0;
		for (;;) {
			check(signal); const result: unknown = await iterator.next(); check(signal);
			const item = record(result, 'native restore Original result', ['done', 'value'], ['done']);
			if (field(item, 'done') === true) { done = true; break; }
			if (field(item, 'done') !== false) throw new TypeError('Native restore iterator completion is malformed.');
			const value = photoPackByteView(field(item, 'value'));
			if (value.byteLength < 1 || value.byteLength > 4 * 1024 * 1024 || value.byteLength > original.byteLength - length) {
				throw new RangeError('Native restore Original chunk exceeds its length budget.');
			}
			const bytes = new Uint8Array(value); hash.update(bytes); length += bytes.byteLength;
			try { if (writer) await writer.write(bytes, { signal }); } finally { bytes.fill(0); }
		}
		if (length !== original.byteLength || hash.digest('hex') !== original.contentSha256) throw new Error('Native restore Original length/SHA digest differs.');
		if (writer) {
			const ack = await writer.commit({ signal }); committed = true;
			if (ack.sourceId !== original.storageKey || ack.size !== original.byteLength || ack.sha256 !== original.contentSha256) throw new Error('Native restore actual body receipt differs.');
		}
		await media.catalogOriginals.stage(photo.catalogId, importId, [{ photoId: photo.id, sourceId: original.id,
			assetId: original.storageKey, sha256: original.contentSha256, size: original.byteLength }], { signal });
		// The actual root COMMIT owns this provisional child ACK.
		receipt = Object.freeze({ photoId: photo.id, assetId: original.storageKey, sha256: original.contentSha256,
			size: original.byteLength, reused: previousRequest !== undefined });
	} catch (error) { failed = true; primary = error; }
	if (!done && !iterator.return) { const error = new Error('Native restore failed producer has no joined return authority.'); cleanup.push(error); unretired(iterator, error); }
	if (!done && iterator.return) {
		try {
			const result: unknown = await iterator.return(), descriptor = result && typeof result === 'object' ? Object.getOwnPropertyDescriptor(result, 'done') : undefined;
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== true) throw new Error('Native restore producer return did not prove retirement.');
		} catch (error) { cleanup.push(error); unretired(iterator, error); }
	}
	if (writer && !committed) { try { await writer.abort(); } catch (error) { cleanup.push(error); unretired(iterator, error); } }
	writerChanged(null);
	if (cleanup.length) { const errors = [...(failed ? [primary] : []), ...cleanup].filter((value, index, values) => values.findIndex(other => Object.is(value, other)) === index);
		if (errors.length === 1) throw errors[0]; throw new AggregateError(errors, 'Native restore Original and cleanup failed.', { cause: cleanup[0] }); }
	if (failed) throw primary; return receipt!;
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
