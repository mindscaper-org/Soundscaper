/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLightscaperNativePhotoCustodyRequestCurrentV1 as capture,
	executeLightscaperNativePhotoCustodyRequestCurrentV1 as execute } from '../desktop/lightscaper-native-photo-media-custody-current-v1.ts';
import { nativeMediaAssetFixtureCurrentV1 as fixture, nativeMediaAssetPublicationCurrentV1 as publish } from './helpers/lightscaper-native-photo-media-assets-fixture-current.ts';

test('Lightscaper native custody refuses an AFTER UPDATE counter rewrite despite SQLite changes===1', async () => {
	await fixture(async f => {
		const { binding } = await publish(f), ref = { photoId: 'photo', sourceId: 'logical-source', assetId: binding.storageKey, sha256: binding.contentSha256, size: binding.byteLength };
		f.db.exec('CREATE TRIGGER custody_counter_rewrite AFTER UPDATE OF root_count ON native_photo_media_assets WHEN NEW.root_count=1 BEGIN UPDATE native_photo_media_assets SET root_count=0 WHERE source_id=NEW.source_id; END');
		try { assert.throws(() => execute(f.db, capture('retain', ['catalog', [ref]]))); }
		finally { f.db.exec('DROP TRIGGER custody_counter_rewrite'); }
		assert.equal(f.db.isTransaction, false); assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_media_roots').get()?.n, 0);
		assert.equal(f.db.prepare('SELECT root_count FROM native_photo_media_assets').get()?.root_count, 0); await f.originals.verifyBinding(binding);
	});
});
