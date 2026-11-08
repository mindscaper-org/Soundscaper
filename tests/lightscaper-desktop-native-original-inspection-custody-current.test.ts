/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import { assert, nativeOriginalInspectionFixtureCurrentV1 as fixture, replaceInspectionRootCurrentV1 as replace,
	INSPECTION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

void test('Lightscaper native inspection requires exactly the requested staged import custody', options, async t => {
	await fixture(t, async f => {
		await assert.rejects(f.inspect({ ...f.binding, importId: 'missing-import' }));
		const reference = { photoId: f.binding.photoId, assetId: f.binding.assetId, sourceId: f.binding.sourceId, sha256: f.binding.sha256, size: f.binding.size };
		await f.media.catalogOriginals.stage('catalog', 'current-import', [reference]);
		assert.deepEqual(await f.inspect({ ...f.binding, importId: 'current-import' }), { status: 'present' });
		await f.media.catalogOriginals.releaseStaged('catalog', 'current-import', ['photo']);
		await assert.rejects(f.inspect({ ...f.binding, importId: 'current-import' }));
	});
});

void test('Lightscaper native inspection refuses missing selected custody even while bytes and managed asset remain', options, async t => {
	await fixture(t, async f => { await f.media.catalogOriginals.release('catalog', ['photo']); await assert.rejects(f.inspect()); });
});

void test('Lightscaper native inspection returns missing media-row only with authenticated retained roots', options, async t => {
	await fixture(t, async f => {
		f.db.exec("PRAGMA foreign_keys=OFF; DELETE FROM native_photo_media_assets WHERE source_id='asset'");
		assert.deepEqual(await f.inspect(), { status: 'missing', reason: 'media-row' });
		replace(f.db, 'photo', root => { root.sha256 = 'a'.repeat(64); }); await assert.rejects(f.inspect());
	});
});

void test('Lightscaper native inspection authenticates every retained root beyond the first 64-row page', options, async t => {
	await fixture(t, async f => {
		for (let page = 0; page < 5; page++) {
			const references = Array.from({ length: 16 }, (_, n) => ({ photoId: `z-${String(page * 16 + n).padStart(3, '0')}`,
				assetId: f.binding.assetId, sourceId: f.binding.sourceId, sha256: f.binding.sha256, size: f.binding.size }));
			await f.media.catalogOriginals.retain('catalog', references); t.signal.throwIfAborted();
		}
		assert.deepEqual(await f.inspect(), { status: 'present' });
		replace(f.db, 'z-079', root => { root.mediaContentToken = 'media-content-0000000000000000'; });
		await assert.rejects(f.inspect());
	});
});

void test('Lightscaper native inspection validates retained root_count against actual complete inventory', options, async t => {
	await fixture(t, async f => {
		for (const value of [0, 2]) { f.db.prepare('UPDATE native_photo_media_assets SET root_count=?').run(value); await assert.rejects(f.inspect()); }
	});
});

void test('Lightscaper native inspection refuses scalar generation and physical binding corruption', options, async t => {
	await fixture(t, async f => {
		f.db.exec("UPDATE native_photo_media_assets SET media_content_token='media-content-0000000000000000'"); await assert.rejects(f.inspect());
	});
	await fixture(t, async f => {
		const corrupt = () => { f.db.exec("UPDATE native_photo_original_bindings SET byte_length=byte_length+1"); };
		assert.throws(corrupt, /FOREIGN KEY/u);
		// Model disk corruption only after proving ordinary writes retain typed identity.
		f.db.exec('PRAGMA foreign_keys=OFF');
		try { corrupt(); } finally { f.db.exec('PRAGMA foreign_keys=ON'); }
		assert.equal(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
		await assert.rejects(f.inspect());
	});
});
