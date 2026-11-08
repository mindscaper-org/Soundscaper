/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getLightscaperNativeLegacyQueryBuildCurrentV1 as build, writeLightscaperNativeLegacyQueryBuildCurrentV1 as writeBuild,
	writeLightscaperNativeLegacyQueryPhotoCurrentV1 as write } from '../desktop/lightscaper-native-legacy-query-write-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { legacyQueryFixtureCurrentV1 as fixture, seedNativeLegacyQueryCurrentV1 as seed, legacyTransactionCurrentV1 as tx,
	replaceLegacyQuerySourceCurrentV1 as source, overflowLegacyQueryPhotoCurrentV1 as overflow, key } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';

const rows = (db: Parameters<typeof write>[0]) => db.prepare('SELECT * FROM native_photo_query_rows_v1 ORDER BY photo_key').all();

test('Lightscaper native legacy writer requires its actual transaction and owned build state', async () => {
	await fixture(db => {
		const f = seed(db, 2, { ready: false, rows: false }); assert.throws(() => write(db, f.photos[0], 'rebuild'), /transaction/iu);
		tx(db, () => write(db, f.photos[0], 'rebuild')); assert.equal(build(db, 'catalog')?.indexedCount, 1);
		tx(db, () => write(db, f.photos[0], 'rebuild')); assert.equal(build(db, 'catalog')?.indexedCount, 1);
		assert.throws(() => tx(db, () => write(db, f.photos[0], 'insert'))); db.exec('DELETE FROM native_photo_query_builds_v1');
		assert.throws(() => tx(db, () => write(db, f.photos[1], 'rebuild'))); assert.equal(rows(db).length, 1);
		assert.throws(() => writeBuild(db, { id: 'catalog', schemaVersion: 1, ready: false, afterKey: null, indexedCount: 1 }), /transaction/iu);
	});
});

test('Lightscaper native legacy writer retires only exact synchronous Row1 overflow while retaining its physical binding', async () => {
	await fixture(db => {
		const f = seed(db, 2), before = rows(db), huge = overflow(f.photos[0]!); assert.throws(() => projectPhotoQueryRowV1(huge), /row exceeds its byte budget/u);
		tx(db, () => { source(db, huge); write(db, huge, 'replace'); });
		assert.deepEqual(rows(db), before); assert.deepEqual(build(db, 'catalog'), { id: 'catalog', schemaVersion: 1, ready: false, afterKey: null, indexedCount: 2 });
		const fixed = normalizePhotoDocumentCurrentV1({ ...f.photos[0]!, revision: huge.revision + 1 });
		tx(db, () => { source(db, fixed); write(db, fixed, 'replace'); });
		assert.equal(build(db, 'catalog')?.indexedCount, 2); assert.equal(build(db, 'catalog')?.ready, false);
		assert.equal(db.prepare('SELECT photo_revision FROM native_photo_query_rows_v1 WHERE photo_key=?').get(key(0))?.photo_revision, fixed.revision);
	});
});

test('Lightscaper native legacy rebuild projection overflow throws without retiring a committed build', async () => {
	await fixture(db => {
		const f = seed(db, 2), before = rows(db), initial = build(db, 'catalog'), huge = overflow(f.photos[0]!);
		assert.throws(() => tx(db, () => { source(db, huge); write(db, huge, 'rebuild'); }), /row exceeds its byte budget/u);
		assert.deepEqual(rows(db), before); assert.deepEqual(build(db, 'catalog'), initial);
		assert.equal(db.prepare('SELECT revision FROM native_photos WHERE photo_key=?').get(key(0))?.revision, 0);
	});
});

test('Lightscaper native legacy overflow retirement resets partial cursor and preserves only existing physical row count', async () => {
	await fixture(db => {
		const f = seed(db, 2, { ready: false }); db.prepare('UPDATE native_photo_query_builds_v1 SET after_key=?').run(key(0));
		tx(db, () => { const huge = overflow(f.photos[1]!); source(db, huge); write(db, huge, 'replace'); });
		assert.equal(build(db, 'catalog')?.afterKey, null); assert.equal(build(db, 'catalog')?.indexedCount, 2);
		assert.equal(rows(db).length, 2);
	});
});

test('Lightscaper native legacy writer SQL refusal rolls back actual source and count publication', async () => {
	await fixture(db => {
		const f = seed(db, 2), before = rows(db), initial = build(db, 'catalog'), next = normalizePhotoDocumentCurrentV1({ ...f.photos[0]!, revision: 1 });
		db.exec("CREATE TRIGGER legacy_refuse BEFORE UPDATE ON native_photo_query_rows_v1 BEGIN SELECT RAISE(ABORT,'legacy SQL full'); END");
		assert.throws(() => tx(db, () => { source(db, next); write(db, next, 'replace'); }), /legacy SQL full/u);
		assert.deepEqual(rows(db), before); assert.deepEqual(build(db, 'catalog'), initial);
		assert.equal(db.prepare('SELECT revision FROM native_photos WHERE photo_key=?').get(key(0))?.revision, 0);
	});
});

test('Lightscaper native legacy writer refuses source revision mismatch malformed stored rows and ready replacement holes', async () => {
	await fixture(db => {
		const f = seed(db, 2); assert.throws(() => tx(db, () => write(db, { ...f.photos[0]!, revision: 1 }, 'replace')));
		db.prepare('UPDATE native_photo_query_rows_v1 SET row_json=? WHERE photo_key=?').run('{bad', key(0));
		assert.throws(() => tx(db, () => write(db, f.photos[0], 'replace')));
		db.prepare('DELETE FROM native_photo_query_rows_v1 WHERE photo_key=?').run(key(1));
		assert.throws(() => tx(db, () => write(db, f.photos[1], 'replace'))); assert.equal(db.isTransaction, false);
	});
});
