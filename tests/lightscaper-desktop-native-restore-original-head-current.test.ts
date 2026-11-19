/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeMediaRestoreFixtureCurrentV1 as fixture, Media } from './helpers/lightscaper-native-media-restore-integration-fixture-current.ts';

for (const kind of ['orphan-locator', 'orphan-head'] as const) void test(`Lightscaper native restore refuses ${kind} outside its actual restored Original inventory`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); await f.catalog.finish();
		f.sql('originals', db => {
			const sha = 'f'.repeat(64), locator = '1'.repeat(64);
			db.prepare("INSERT INTO native_photo_original_body_locators VALUES(?,?,?,'generation-v1')").run(sha, locator, 1);
			if (kind === 'orphan-head') db.prepare('INSERT INTO native_photo_original_body_heads VALUES(?,?,?,0)').run(sha, locator, 1);
		});
		await assert.rejects(f.finish(), /inventory|locator|Original|head/iu);
	});
});

void test('Lightscaper native archive restore authenticates actual repaired generation heads before issuing its opaque receipt', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); await f.catalog.finish();
		const media = await Media.open({ appDataPath: f.appDataPath });
		try {
			const photo = f.photos[0]!, original = photo.original;
			assert.deepEqual(await media.restoreCatalogOriginalBody({ catalogId: photo.catalogId, importId: f.candidate.allocation.operationId,
				photoId: photo.id, assetId: original.storageKey, sourceId: original.id, sha256: original.contentSha256,
				size: original.byteLength, name: original.name, mimeType: original.mimeType }, new Blob([f.values[0]!]), { signal: context.signal }),
			{ assetId: original.storageKey, sha256: original.contentSha256, size: original.byteLength });
			await media.verifyOriginal(original, { signal: context.signal });
		} finally { await media.close(); }
		const receipt = await f.finish(); assert.match(receipt.inventorySha256, /^[a-f0-9]{64}$/u);
		assert.equal(receipt.originalCount, 2); assert.equal(receipt.photoCount, 3);
	});
});
