/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { rebuildLightscaperNativeLegacyQueryIndexPageCurrentV1 as rebuild } from '../desktop/lightscaper-native-legacy-query-rebuild-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1 as build, writeLightscaperNativeLegacyQueryPhotoCurrentV1 as write } from '../desktop/lightscaper-native-legacy-query-write-current-v1.ts';
import { writeLightscaperNativeQueryPhotoCurrentV1 as writeV2 } from '../desktop/lightscaper-native-query-write-current-v1.ts';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { legacyQueryFixtureCurrentV1 as fixture, seedNativeLegacyQueryCurrentV1 as seed, legacyTransactionCurrentV1 as tx,
	replaceLegacyQuerySourceCurrentV1 as source, overflowLegacyQueryPhotoCurrentV1 as overflow, key } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';

const physical = (db: DatabaseSync) => db.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v1').get()?.count;
const sourceBytes = (db: DatabaseSync) => db.prepare('SELECT photo_key,revision,document,summary FROM native_photos ORDER BY photo_key').all();

test('Lightscaper native legacy rebuild resumes actual disk Current1 Current2 Current3 sources and reports exact combined bytes', async () => {
	await fixture((db, path) => {
		const f = seed(db, 33, { ready: false, rows: false, patch: (p, i) => normalizePhotoDocumentCurrentV1({ ...p, schemaVersion: i % 3 + 1 }) }), before = sourceBytes(db);
		const first = rebuild(db, 'catalog'); assert.equal(first.processed, 16); assert.equal(first.ready, false);
		assert.equal(first.bytes, f.photos.slice(0,16).reduce((n,p) => n + Buffer.byteLength(serializePhotoDocumentCurrentV1(p)) + Buffer.byteLength(JSON.stringify(projectPhotoQueryRowV1(p))), 0));
		assert.deepEqual(Object.keys(first).sort(), ['bytes','processed','ready']);
		const reopened = new DatabaseSync(path); try {
			initializeLightscaperNativeCatalogDatabaseCurrentV1(reopened); assert.equal(build(reopened, 'catalog')?.afterKey, key(15));
			assert.equal(rebuild(reopened, 'catalog').processed, 16); const last = rebuild(reopened, 'catalog'); assert.equal(last.processed, 1); assert.equal(last.ready, true);
			assert.deepEqual(rebuild(reopened, 'catalog'), { processed: 0, bytes: 0, ready: true }); assert.equal(physical(reopened), 33);
		} finally { reopened.close(); }
		assert.deepEqual(sourceBytes(db), before);
	});
});

test('Lightscaper native legacy rebuild byte bound includes derived row and stops before the next legal rich Current source', async () => {
	await fixture(db => {
		const effects = Array.from({ length: 95 }, (_, i) => ({ id: `effect-${String(i)}-${'x'.repeat(100)}`, type: 'color-adjust', enabled: true, params: {} }));
		const f = seed(db, 8, { ready: false, rows: false, patch: p => normalizePhotoDocumentCurrentV1({ ...p, schemaVersion: 2,
			activeVersionId: 'version-0', versions: Array.from({ length: 64 }, (_, i) => ({ ...p.versions[0]!, id: `version-${String(i)}`,
				kind: i === 0 ? 'master' : 'virtual-copy', develop: { ...p.versions[0]!.develop, effects: [...p.versions[0]!.develop.effects, ...effects] } })) }) });
		let expected = 0, bytes = 0;
		for (const p of f.photos) { const length = Buffer.byteLength(serializePhotoDocumentCurrentV1(p)) + Buffer.byteLength(JSON.stringify(projectPhotoQueryRowV1(p))); if (bytes + length > 8_388_608) break; expected++; bytes += length; }
		assert.ok(expected > 0 && expected < 8); const page = rebuild(db, 'catalog');
		assert.equal(page.processed, expected); assert.equal(page.bytes, bytes); assert.equal(page.ready, false); assert.equal(physical(db), expected);
	});
});

for (const target of ['row','progress'] as const) test(`Lightscaper native legacy real ${target} SQL failure rolls back only its current rebuild step`, async () => {
	await fixture(db => {
		seed(db, 20, { ready: false, rows: false }); rebuild(db, 'catalog'); const before = build(db, 'catalog');
		db.exec(target === 'row' ? "CREATE TRIGGER fail_legacy BEFORE INSERT ON native_photo_query_rows_v1 BEGIN SELECT RAISE(ABORT,'legacy page row'); END"
			: "CREATE TRIGGER fail_legacy BEFORE UPDATE ON native_photo_query_builds_v1 WHEN NEW.after_key IS NOT OLD.after_key BEGIN SELECT RAISE(ABORT,'legacy page progress'); END");
		assert.throws(() => rebuild(db, 'catalog'), /legacy page/u); assert.equal(physical(db), 16); assert.deepEqual(build(db, 'catalog'), before);
		db.exec('DROP TRIGGER fail_legacy'); assert.equal(rebuild(db, 'catalog').ready, true); assert.equal(physical(db), 20);
	});
});

test('Lightscaper native legacy later corrupt source and overflow leave earlier committed cursor intact', async () => {
	await fixture(db => {
		const f = seed(db, 20, { ready: false, rows: false }); rebuild(db, 'catalog'); const before = build(db, 'catalog');
		db.prepare('UPDATE native_photos SET document=? WHERE photo_key=?').run('{broken', key(18));
		assert.throws(() => rebuild(db, 'catalog')); assert.equal(physical(db), 16); assert.deepEqual(build(db, 'catalog'), before);
		source(db, overflow(f.photos[18]!)); assert.throws(() => rebuild(db, 'catalog'), /row exceeds its byte budget/u);
		assert.deepEqual(build(db, 'catalog'), before); assert.equal(physical(db), 16); assert.equal(db.isTransaction, false);
	});
});

test('Lightscaper native legacy final physical count and bounded cursor anchor refuse missing prior coverage', async () => {
	for (const selected of [0,15]) await fixture(db => {
		seed(db, 20, { ready: false, rows: false }); rebuild(db, 'catalog'); const before = build(db, 'catalog');
		db.prepare('DELETE FROM native_photo_query_rows_v1 WHERE photo_key=?').run(key(selected));
		assert.throws(() => rebuild(db, 'catalog'), /coverage|count|cursor|stale/iu); assert.deepEqual(build(db, 'catalog'), before);
		assert.equal(physical(db), 15); assert.equal(db.isTransaction, false);
	});
});

test('Lightscaper native legacy independent actual connection updates before after and behind the saved rebuild cursor', async () => {
	await fixture((db, path) => {
		const f = seed(db, 20, { ready: false, rows: false }); rebuild(db, 'catalog'); const writer = new DatabaseSync(path);
		try {
			initializeLightscaperNativeCatalogDatabaseCurrentV1(writer);
			tx(writer, () => {
				for (const i of [0,18]) { const p = normalizePhotoDocumentCurrentV1({ ...f.photos[i]!, revision: 1, rating: 5 }); source(writer, p); write(writer, p, 'replace'); writeV2(writer, p, 'replace'); }
				const added = normalizePhotoDocumentCurrentV1({ ...f.photos[1]!, id: 'a-before', revision: 0 }), storage = photoStorageKey('catalog', added.id);
				writer.prepare('INSERT INTO native_photos VALUES(?,?,?,?,?,?)').run(storage, 'catalog', added.id, 0, json(added), json(photoSummary(added))); write(writer, added, 'insert'); writeV2(writer, added, 'insert');
				writer.prepare('UPDATE native_photo_catalogs SET root_revision=4,index_revision=12,photo_count=21,document=? WHERE id=?').run(json({ ...f.root, revision: 4, photoCount: 21 }), 'catalog');
			});
			assert.equal(rebuild(db, 'catalog').ready, true); assert.equal(physical(db), 21); assert.equal(build(db, 'catalog')?.indexedCount, 21);
			for (const i of [0,18]) assert.equal(db.prepare('SELECT photo_revision FROM native_photo_query_rows_v1 WHERE photo_key=?').get(key(i))?.photo_revision, 1);
		} finally { writer.close(); }
	});
});

test('Lightscaper native legacy rebuild native opaque cancellation rolls back current rows and late abort preserves completed acknowledgement', async () => {
	await fixture(db => {
		seed(db, 2, { ready: false, rows: false }); const stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque'); }, getPrototypeOf() { traps++; throw Error('Opaque'); } });
		db.setAuthorizer((action, table) => { if (action === constants.SQLITE_READ && table === 'native_photos') stop.abort(reason); return constants.SQLITE_OK; });
		let failure: unknown; try { rebuild(db, 'catalog', { signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(traps, 0); assert.equal(physical(db), 0); assert.equal(build(db, 'catalog')?.afterKey, null); db.setAuthorizer(null);
		const late = new AbortController(), page = rebuild(db, 'catalog', { signal: late.signal }); late.abort(reason);
		assert.equal(page.ready, true); assert.equal(physical(db), 2); assert.equal(db.isTransaction, false);
	});
});


test('Lightscaper native legacy overflowing edited source remains unavailable until a fitting edit genuinely rebuilds ready', async () => {
	await fixture(db => {
		const f = seed(db, 2), huge = overflow(f.photos[0]!);
		tx(db, () => { source(db, huge); write(db, huge, 'replace'); });
		assert.equal(build(db, 'catalog')?.ready, false); assert.throws(() => rebuild(db, 'catalog'), /row exceeds its byte budget/u);
		const fixed = normalizePhotoDocumentCurrentV1({ ...f.photos[0]!, revision: huge.revision + 1 });
		tx(db, () => { source(db, fixed); write(db, fixed, 'replace'); });
		assert.equal(build(db, 'catalog')?.ready, false); const rebuilt = rebuild(db, 'catalog');
		assert.equal(rebuilt.processed, 2); assert.equal(rebuilt.ready, true); assert.equal(build(db, 'catalog')?.indexedCount, 2); assert.equal(physical(db), 2);
	});
});
