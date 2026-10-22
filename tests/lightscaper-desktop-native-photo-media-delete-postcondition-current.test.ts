/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getLightscaperNativePhotoMediaAssetCurrentV1 as get,
	deleteLightscaperNativePhotoMediaAssetCurrentV1 as remove } from '../desktop/lightscaper-native-photo-media-assets-current-v1.ts';
import { nativeMediaAssetFixtureCurrentV1 as fixture, nativeMediaAssetPublicationCurrentV1 as publish } from './helpers/lightscaper-native-photo-media-assets-fixture-current.ts';

for (const mode of ['ignored', 'reinserted'] as const) {
	test(`Lightscaper native asset deletion refuses a real ${mode} binding deletion and rolls back its asset`, async () => {
		await fixture(async f => {
			const { binding } = await publish(f);
			const trigger = mode === 'ignored'
				? "CREATE TRIGGER binding_delete_postcondition BEFORE DELETE ON native_photo_original_bindings BEGIN SELECT RAISE(IGNORE); END"
				: 'CREATE TRIGGER binding_delete_postcondition AFTER DELETE ON native_photo_original_bindings BEGIN INSERT INTO native_photo_original_bindings(storage_key,content_sha256,byte_length) VALUES(OLD.storage_key,OLD.content_sha256,OLD.byte_length); END';
			f.db.exec(trigger);
			try { assert.throws(() => remove(f.db, 'asset')); }
			finally { f.db.exec('DROP TRIGGER binding_delete_postcondition'); }
			assert.equal(f.db.isTransaction, false); assert.ok(get(f.db, 'asset')); await f.originals.verifyBinding(binding);
		});
	});
}
