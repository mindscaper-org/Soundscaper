/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLightscaperNativePhotoCustodyRequestCurrentV1 as capture,
	executeLightscaperNativePhotoCustodyRequestCurrentV1 as execute } from '../desktop/lightscaper-native-photo-media-custody-current-v1.ts';
import { nativeMediaAssetFixtureCurrentV1 as fixture, nativeMediaAssetPublicationCurrentV1 as publish } from './helpers/lightscaper-native-photo-media-assets-fixture-current.ts';

for (const kind of ['ignored-insert', 'removed-after-insert', 'ignored-count'] as const) {
	test(`Lightscaper native custody refuses ${kind} without acknowledging a nonexistent root/count publication`, async () => {
		await fixture(async f => {
			const { binding } = await publish(f), ref = { photoId: 'photo', sourceId: 'logical-source', assetId: binding.storageKey, sha256: binding.contentSha256, size: binding.byteLength };
			const sql = kind === 'ignored-insert'
				? 'BEFORE INSERT ON native_photo_media_roots BEGIN SELECT RAISE(IGNORE); END'
				: kind === 'removed-after-insert' ? 'AFTER INSERT ON native_photo_media_roots BEGIN DELETE FROM native_photo_media_roots WHERE root_key=NEW.root_key; END'
					: 'BEFORE UPDATE OF root_count ON native_photo_media_assets BEGIN SELECT RAISE(IGNORE); END';
			f.db.exec(`CREATE TRIGGER custody_publication_fault ${sql}`);
			try { assert.throws(() => execute(f.db, capture('retain', ['catalog', [ref]]))); }
			finally { f.db.exec('DROP TRIGGER custody_publication_fault'); }
			assert.equal(f.db.isTransaction, false); assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_media_roots').get()?.n, 0);
			assert.equal(f.db.prepare('SELECT root_count FROM native_photo_media_assets').get()?.root_count, 0); await f.originals.verifyBinding(binding);
		});
	});
}

for (const kind of ['ignored-delete', 'reinserted-delete'] as const) {
	test(`Lightscaper native custody refuses ${kind} without acknowledging retirement of a retained root`, async () => {
		await fixture(async f => {
			const { binding } = await publish(f), ref = { photoId: 'photo', sourceId: 'logical-source', assetId: binding.storageKey, sha256: binding.contentSha256, size: binding.byteLength };
			execute(f.db, capture('retain', ['catalog', [ref]]));
			const sql = kind === 'ignored-delete' ? 'BEFORE DELETE ON native_photo_media_roots BEGIN SELECT RAISE(IGNORE); END'
				: 'AFTER DELETE ON native_photo_media_roots BEGIN INSERT INTO native_photo_media_roots VALUES(OLD.root_key,OLD.scope_key,OLD.asset_id,OLD.root); END';
			f.db.exec(`CREATE TRIGGER custody_retirement_fault ${sql}`);
			try { assert.throws(() => execute(f.db, capture('release', ['catalog', ['photo']]))); }
			finally { f.db.exec('DROP TRIGGER custody_retirement_fault'); }
			assert.equal(f.db.isTransaction, false); assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_media_roots').get()?.n, 1);
			assert.equal(f.db.prepare('SELECT root_count FROM native_photo_media_assets').get()?.root_count, 1); await f.originals.verifyBinding(binding);
		});
	});
}
