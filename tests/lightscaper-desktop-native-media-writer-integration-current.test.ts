/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths,
	lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { nativeWriterFixtureCurrentV1 as fixture, beginNativeWriterCurrentV1 as begin, nativeWriterInputCurrentV1 as input,
	writeNativeWriterInputCurrentV1 as writeAll, readNativeWriterOriginalCurrentV1 as read,
	nativeWriterReferenceCurrentV1 as reference, observeNativeWriterFileWritesCurrentV1 as observeWrites,
	NATIVE_WRITER_CHUNK_CURRENT_V1 as CHUNK, NATIVE_WRITER_CATALOG_CURRENT_V1 as CATALOG } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';

test('Lightscaper >4MiB native streamed body splits real writes to1MiB and publishes exact SHA bytes with cached commit', async () => {
	await fixture(async f => {
		const value = input(), lengths: number[] = [], writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		const receipt = await observeWrites(f.appDataPath, length => { lengths.push(length); }, async () => {
			assert.equal(writer.maximumChunkBytes, CHUNK); await writer.write(value.bytes.subarray(0, CHUNK));
			assert.equal(writer.bytesWritten, CHUNK); await writer.write(value.bytes.subarray(CHUNK)); assert.equal(writer.bytesWritten, value.bytes.length);
			const committing = writer.commit(); assert.equal(writer.commit(), committing); const result = await committing;
			assert.equal(writer.commit(), committing); return result;
		});
		assert.ok(lengths.length >= 5); assert.ok(lengths.every(length => length > 0 && length <= 1024 * 1024));
		assert.equal(lengths.reduce((sum, length) => sum + length, 0), value.bytes.length);
		assert.equal(receipt.sourceId, value.original.storageKey); assert.equal(receipt.sha256, value.options.expectedSha256); assert.equal(receipt.size, value.bytes.length);
		assert.equal(receipt.name, value.metadata.name); assert.equal(receipt.mimeType, value.metadata.mimeType); assert.equal(receipt.lastModified, 17);
		assert.deepEqual(new Uint8Array(await readFile(bodyPath(paths(f.appDataPath), value.options.expectedSha256))), value.bytes);
		assert.deepEqual(await readdir(paths(f.appDataPath).stagingRoot), []); assert.deepEqual(await read(f.media, value.original), value.bytes);
		const db = new DatabaseSync(f.originalDatabasePath);
		try {
			assert.equal(db.prepare('SELECT byte_length FROM native_photo_original_bindings WHERE storage_key=?').get(value.original.storageKey)?.byte_length, value.bytes.length);
			assert.equal(db.prepare('SELECT root_count FROM native_photo_media_assets WHERE source_id=?').get(value.original.storageKey)?.root_count, 0);
		} finally { db.close(); }
	});
});

test('Lightscaper streamed native Original supports real catalog aliases retained custody and reopen without replacement', async () => {
	await fixture(async f => {
		const value = input(602, 8192), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await writeAll(writer, value.bytes); const receipt = await writer.commit();
		const alias = normalizePhotoDocumentCurrentV1({ ...value.photo, id: 'photo-stream-alias', original: { ...value.original, id: 'source-stream-alias', name: 'Alias.dng' } });
		await f.catalog.publishPhotos(CATALOG, 0, [value.photo, alias]);
		await f.media.catalogOriginals.retain(CATALOG, [reference(value.original, value.photo.id), reference(alias.original, alias.id)]);
		const roots = await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null });
		assert.equal(roots.roots.length, 2); assert.equal(new Set(roots.roots.map(root => root.mediaContentToken)).size, 1);
		await assert.rejects(f.media.deleteAsset(value.original.storageKey)); await f.close(); const reopened = await f.reopen();
		assert.deepEqual(await reopened.media.getAssetMetadata(value.original.storageKey), receipt);
		assert.deepEqual(await read(reopened.media, alias.original), value.bytes);
		assert.deepEqual(await reopened.catalog.loadPhoto(CATALOG, alias.id), alias);
		assert.equal((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots.length, 2);
	});
});

test('Lightscaper streamed short body refuses commit and never publishes an asset or binding', async () => {
	await fixture(async f => {
		const value = input(603, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await writer.write(value.bytes.subarray(0, value.bytes.length - 1)); await assert.rejects(writer.commit()); await writer.abort();
		assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
		const db = new DatabaseSync(f.originalDatabasePath); try { assert.equal(db.prepare('SELECT 1 FROM native_photo_original_bindings WHERE storage_key=?').get(value.original.storageKey), undefined); } finally { db.close(); }
		assert.deepEqual(await readdir(paths(f.appDataPath).stagingRoot), []);
	});
});

test('Lightscaper streamed exact length with wrong SHA refuses actual file publication and leaves no authoritative receipt', async () => {
	await fixture(async f => {
		const value = input(604, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, { ...value.options, expectedSha256: '0'.repeat(64) });
		await writeAll(writer, value.bytes); await assert.rejects(writer.commit()); await writer.abort();
		assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null); await assert.rejects(f.media.verifyOriginal(value.original));
		assert.deepEqual(await readdir(paths(f.appDataPath).stagingRoot), []);
	});
});

test('Lightscaper streamed overlength write fences its actual stage without publishing metadata', async () => {
	await fixture(async f => {
		const value = input(605, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await assert.rejects(async () => { await writer.write(new Uint8Array(value.bytes.length + 1)); });
		await writer.abort(); await assert.rejects(writer.commit()); assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
		assert.deepEqual(await readdir(paths(f.appDataPath).stagingRoot), []);
	});
});

test('Lightscaper shared4MiB emission ceiling is enforced before a native stream can accept an oversized emission', async () => {
	await fixture(async f => {
		const value = input(606), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await assert.rejects(async () => { await writer.write(value.bytes.subarray(0, CHUNK + 1)); });
		await writer.abort(); assert.equal(await f.media.getAssetMetadata(value.original.storageKey), null);
	});
});

test('Lightscaper committed native streamed identity refuses a second begin without changing its receipt or body', async () => {
	await fixture(async f => {
		const value = input(607, 4096), writer = await begin(f.media, value.original.storageKey, value.metadata, value.options);
		await writeAll(writer, value.bytes); const receipt = await writer.commit();
		await assert.rejects(begin(f.media, value.original.storageKey, { name: 'Replacement' }, value.options));
		assert.deepEqual(await f.media.getAssetMetadata(value.original.storageKey), receipt); assert.deepEqual(await read(f.media, value.original), value.bytes);
	});
});
