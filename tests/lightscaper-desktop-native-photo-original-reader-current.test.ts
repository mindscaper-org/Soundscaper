/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeOriginalReaderFixtureCurrentV1 as fixture, readerShaCurrentV1 as sha,
	READER_CATALOG_CURRENT_V1 as CATALOG, photoImportIntentKeyV1 as intentKey, readerIntentCurrentV1,
	Media, normalizePhotoDocumentCurrentV1 } from './helpers/lightscaper-native-photo-original-reader-fixture-current.ts';

test('Lightscaper native Original reader returns authenticated bounded detached bytes and fences escaped views', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		let escaped: { read(offset: number, length: number): Promise<Uint8Array> } | undefined;
		const receipt = await f.reader.withOriginal(f.request, async view => {
			escaped = view; assert.deepEqual(view.original, f.entry.original); assert.equal(Object.isFrozen(view), true);
			const chunks: Uint8Array[] = [];
			for (let offset = 0; offset < f.entry.bytes.length; offset += 1024 * 1024) chunks.push(await view.read(offset, Math.min(1024 * 1024, f.entry.bytes.length - offset)));
			assert.equal(sha(Buffer.concat(chunks)), sha(f.entry.bytes));
			chunks[0]!.fill(0); assert.equal(sha(await view.read(0, 97)), sha(f.entry.bytes.subarray(0, 97)));
			for (const [offset, length] of [[-1, 1], [-0, 1], [0, 0], [0, 1024 * 1024 + 1], [1, f.entry.bytes.length], [0.5, 1]]) {
				await assert.rejects(view.read(offset!, length!));
			}
			return 'actual consumer retired';
		});
		assert.equal(receipt, 'actual consumer retired'); assert.ok(escaped); await assert.rejects(escaped.read(0, 1));
	});
});

test('Lightscaper native Original reader binds the whole stored Original rather than digest alone', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		let calls = 0;
		for (const request of [{ ...f.request, photoId: 'absent-photo' }, { ...f.request, catalogId: 'other-catalog' },
			{ ...f.request, original: { ...f.entry.original, name: 'Different descriptive identity.dng' } },
			{ ...f.request, original: { ...f.entry.original, id: 'other-original' } }]) {
			await assert.rejects(f.reader.withOriginal(request, () => { calls++; }));
		}
		assert.equal(calls, 0);
	});
});

test('Lightscaper native Original reader refuses an unretained physical Original', { timeout: 15_000 }, async () => {
	await fixture(async f => { let called = false; await assert.rejects(f.reader.withOriginal(f.request, () => { called = true; })); assert.equal(called, false); }, { unretained: true });
});

test('Lightscaper native Original reader accepts active staged custody and reauthorizes promotion', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.reader.withOriginal(f.request, async view => {
			assert.equal(sha(await view.read(0, 71)), sha(f.entry.bytes.subarray(0, 71)));
			await f.media.catalogOriginals.promote(CATALOG, 'active-import', [f.entry.photo.id]);
			await f.settings.settingsRepository.delete(intentKey(CATALOG));
			assert.equal(sha(await view.read(73, 19)), sha(f.entry.bytes.subarray(73, 92)));
		});
	}, { staged: 'active-import' });
});

test('Lightscaper native Original reader requires the actual selected Settings intent for staged custody', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.settings.settingsRepository.put(intentKey(CATALOG), readerIntentCurrentV1('different-import'));
		await assert.rejects(f.reader.withOriginal(f.request, () => assert.fail('Mismatched staged custody reached a consumer.')));
		await f.settings.settingsRepository.delete(intentKey(CATALOG));
		await assert.rejects(f.reader.withOriginal(f.request, () => assert.fail('Missing intent reached a consumer.')));
	}, { staged: 'active-import' });
});

test('Lightscaper native Original reader permits attribute edits and reentrant catalog reads during the consumer', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.reader.withOriginal(f.request, async view => {
			const saved = await f.catalog.savePhoto({ ...f.entry.photo, rating: 4, flag: 'pick', colorLabel: 'green' }, f.entry.photo.revision);
			assert.equal(saved.revision, f.entry.photo.revision + 1); assert.deepEqual(saved.original, f.entry.original);
			assert.ok(await f.catalog.readSnapshot(CATALOG));
			assert.equal(sha(await view.read(0, 127)), sha(f.entry.bytes.subarray(0, 127)));
		});
	});
});

test('Lightscaper native Original reader uses scalar provenance without decoding generic asset metadata', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		f.database.prepare('UPDATE native_photo_media_assets SET metadata=? WHERE source_id=?').run(Uint8Array.of(0), f.entry.original.storageKey);
		await assert.rejects(f.media.getAssetMetadata(f.entry.original.storageKey));
		await f.reader.withOriginal(f.request, async view => { assert.equal(sha(await view.read(0, 83)), sha(f.entry.bytes.subarray(0, 83))); });
	});
});

test('Lightscaper native Original reader pins deletion across separate same-process Media owners', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const peer = await Media.open({ appDataPath: f.appDataPath });
		try {
			await assert.rejects(f.reader.withOriginal(f.request, async view => {
				await f.media.catalogOriginals.release(CATALOG, [f.entry.photo.id]);
				await assert.rejects(f.media.deleteAsset(f.entry.original.storageKey)); await assert.rejects(peer.deleteAsset(f.entry.original.storageKey));
				await assert.rejects(view.read(0, 1)); throw new Error('The consumer observed invalidated custody.');
			}));
			await peer.deleteAsset(f.entry.original.storageKey); assert.equal(await peer.getAssetMetadata(f.entry.original.storageKey), null);
		} finally { await peer.close(); }
	});
});

test('Lightscaper native Original reader rejects a changed asset generation even with matching new roots', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await assert.rejects(f.reader.withOriginal(f.request, async view => {
			const row = f.database.prepare('SELECT root_key,root FROM native_photo_media_roots').get(); assert.ok(row && typeof row.root === 'string');
			const root: unknown = JSON.parse(row.root); assert.ok(root && typeof root === 'object');
			const replacement = 'media-content-0123456789abcdef0123456789abcdef';
			f.database.exec('BEGIN IMMEDIATE');
			try {
				f.database.prepare('UPDATE native_photo_media_assets SET media_content_token=? WHERE source_id=?').run(replacement, f.entry.original.storageKey);
				f.database.prepare('UPDATE native_photo_media_roots SET root=? WHERE root_key=?').run(JSON.stringify({ ...root, mediaContentToken: replacement }), row.root_key!);
				f.database.exec('COMMIT');
			} catch (error) { f.database.exec('ROLLBACK'); throw error; }
			await assert.rejects(view.read(0, 1)); throw new Error('The consumer observed changed generation.');
		}));
	});
});

test('Lightscaper native Original reader captures the complete request before queued reflection can change it', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const original = { ...f.entry.original }, request = { ...f.request, original };
		const work = f.reader.withOriginal(request, async view => { assert.deepEqual(view.original, f.entry.original); assert.equal(sha(await view.read(0, 17)), sha(f.entry.bytes.subarray(0, 17))); });
		original.name = 'Changed after capture.dng'; request.photoId = 'changed-after-capture'; await work;
		const linked = normalizePhotoDocumentCurrentV1({ ...f.entry.photo, original: { ...f.entry.original, retention: 'linked' } });
		await assert.rejects(f.reader.withOriginal({ ...f.request, original: linked.original }, () => undefined));
	});
});
