/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { readLightscaperNativeSmartCollectionRowCurrentV1 as readRecord, readLightscaperNativeSmartCollectionSummaryRowCurrentV1 as readSummary,
	readLightscaperNativeSmartCollectionStateRowCurrentV1 as readState } from '../desktop/lightscaper-native-smart-collection-records-current-v1.ts';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 as capture,
	readLightscaperNativeSmartCollectionPairCurrentV1 as pair } from '../desktop/lightscaper-native-smart-collection-context-current-v1.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { normalizePhotoSmartCollectionV1, photoSmartCollectionSummaryV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { nativeSmartCollectionDefinitionFixtureCurrentV1 as definition, seedNativeSmartCollectionFixtureCurrentV1 as seed, insertNativeSmartCollectionFixtureCurrentV1 as insert } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';

const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false });
const native = (changes: Record<string, unknown> = {}) => { const d = definition(), r = photoSmartCollectionRecordV1(d); return {
	collection_key: r.key, catalog_id: d.catalogId, collection_id: d.id, revision: d.revision, document: JSON.stringify(d), reference_keys: JSON.stringify(r.referenceKeys), ...changes }; };
const scalar = (changes: Record<string, unknown> = {}) => { const d = definition(); return {
	collection_key: photoSmartCollectionRecordV1(d).key, catalog_id: d.catalogId, collection_id: d.id, revision: d.revision, name: JSON.stringify(d.name), ...changes }; };
function snapshot<T>(db: DatabaseSync, run: () => T): T {
	db.exec('BEGIN'); try { const value = run(); db.exec('COMMIT'); return value; } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

test('Lightscaper native saved definition admits exact native six fields, complete Query2 and the entire sorted reference projection', () => {
	assert.deepEqual(readRecord(native(), 'catalog'), photoSmartCollectionRecordV1(definition()));
	for (const change of [{ collection_key: '["catalog", "saved-00000"]' }, { catalog_id: 'other' }, { collection_id: 'wrong' }, { revision: 9 },
		{ reference_keys: '[]' }, { reference_keys: JSON.stringify([...photoSmartCollectionRecordV1(definition()).referenceKeys].reverse()) },
		{ reference_keys: '{broken' }, { document: '{broken' }, { document: JSON.stringify({ ...definition(), schemaVersion: 2 }) }, { extra: 1 }]) {
		assert.throws(() => readRecord(native(change), 'catalog'));
	}
	for (const field of ['text', 'filter', 'sort', 'predicate']) {
		const query: Record<string, unknown> = { ...definition().query }; delete query[field];
		assert.throws(() => readRecord(native({ document: JSON.stringify({ ...definition(), query }) }), 'catalog'));
	}
	assert.throws(() => readRecord(native(), 'other')); assert.throws(() => readRecord(native(), 'catalog', '["catalog","wrong"]'));
	assert.throws(() => readRecord(native({ document: 'ä'.repeat(528_384) }), 'catalog'), RangeError);
	let invoked = 0; const value = native(); Object.defineProperty(value, 'document', { enumerable: true, get() { invoked++; return ''; } });
	assert.throws(() => readRecord(value, 'catalog')); assert.equal(invoked, 0);
});

test('Lightscaper native saved scalar summaries and physical states retain exact owning profiles and scalar identity', () => {
	assert.deepEqual(readSummary(scalar(), 'catalog'), photoSmartCollectionSummaryV1(definition()));
	for (const change of [{ collection_key: '["catalog", "saved-00000"]' }, { catalog_id: 'other' }, { collection_id: 'wrong' }, { revision: -1 }, { name: '' }, { document: '{}' }]) {
		assert.throws(() => readSummary(scalar(change), 'catalog'));
	}
	assert.deepEqual(readState({ catalog_id: 'catalog', revision: 13, collection_count: 0 }, 'catalog'), {
		schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 13, collectionCount: 0 });
	for (const change of [{ catalog_id: 'other' }, { revision: -1 }, { collection_count: 10_001 }, { collection_count: 0.5 }, { extra: 1 }]) {
		assert.throws(() => readState({ catalog_id: 'catalog', revision: 0, collection_count: 0, ...change }, 'catalog'));
	}
});

test('Lightscaper native saved context distinguishes absent, explicit empty zero and retained tombstone through actual disk reopen without writes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper saved context ')); let db: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); db = new DatabaseSync(path); initialize(db); seed(db);
		for (const revision of [null, 0, 14]) {
			if (revision !== null) db.prepare('INSERT INTO native_photo_smart_collection_states VALUES (?,?,0) ON CONFLICT(catalog_id) DO UPDATE SET revision=excluded.revision').run('catalog', revision);
			db.close(); db = new DatabaseSync(path); initialize(db);
			db.setAuthorizer((action, table) => [constants.SQLITE_INSERT, constants.SQLITE_UPDATE, constants.SQLITE_DELETE].includes(action)
				|| action === constants.SQLITE_READ && (table?.startsWith('native_photo_query_') ?? false) ? constants.SQLITE_DENY : constants.SQLITE_OK);
			const value = snapshot(db, () => capture(db!, 'catalog', null)); db.setAuthorizer(null);
			assert.deepEqual(Object.keys(value).sort(), ['root', 'index', 'state', 'persistedState', 'definition', 'record', 'summary'].sort());
			assert.equal(value.state.revision, revision ?? 0); assert.equal(value.state.collectionCount, 0);
			assert.equal(value.persistedState === null, revision === null); if (revision !== null) assert.equal(value.persistedState?.revision, revision);
			assert.equal(value.definition, null); assert.equal(value.record, null); assert.equal(value.summary, null);
			assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_smart_collection_states').get()?.count, revision === null ? 0 : 1);
		}
	} finally { if (db?.isOpen) { db.setAuthorizer(null); db.close(); } await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native saved context first-key guards load no recipe and refuse missing or zero state with either retained side', () => {
	for (const retained of ['definition', 'summary', 'both']) {
		const db = makeDatabase(); try {
			initialize(db); seed(db, 1, null);
			if (retained === 'definition') db.exec('DELETE FROM native_photo_smart_collection_summaries');
			if (retained === 'summary') db.exec('DELETE FROM native_photo_smart_collections');
			db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && table === 'native_photo_smart_collections' && column === 'document' ? constants.SQLITE_DENY : constants.SQLITE_OK);
			assert.throws(() => snapshot(db, () => capture(db, 'catalog', null)), /state|retained|empty/iu);
			db.setAuthorizer(null); db.exec("INSERT INTO native_photo_smart_collection_states VALUES ('catalog',0,0)");
			assert.throws(() => snapshot(db, () => capture(db, 'catalog', null)));
		} finally { db.setAuthorizer(null); db.close(); }
	}
	const db = makeDatabase(); try {
		initialize(db); seed(db, 1); db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && table === 'native_photo_smart_collections' && column === 'document' ? constants.SQLITE_DENY : constants.SQLITE_OK);
		assert.equal(snapshot(db, () => capture(db, 'catalog', null)).state.collectionCount, 1);
	} finally { db.setAuthorizer(null); db.close(); }
});

test('Lightscaper native saved selected pair binds both rows and validates every root reference while true absence remains null', () => {
	const db = makeDatabase(); try {
		initialize(db); const f = seed(db, 2); const selected = snapshot(db, () => capture(db, 'catalog', f.definitions[0]!.id));
		assert.deepEqual(selected.definition, f.definitions[0]); assert.deepEqual(selected.record, photoSmartCollectionRecordV1(f.definitions[0]));
		assert.deepEqual(selected.summary, photoSmartCollectionSummaryV1(f.definitions[0]));
		assert.equal(snapshot(db, () => pair(db, 'catalog', '["catalog","missing"]', f.root)), null);
		assert.throws(() => capture(db, 'catalog', null)); assert.throws(() => pair(db, 'catalog', f.key(0), f.root));
		db.prepare('UPDATE native_photo_smart_collection_summaries SET name=? WHERE collection_key=?').run(JSON.stringify('Changed'), f.key(0));
		assert.throws(() => snapshot(db, () => capture(db, 'catalog', f.definitions[0]!.id)), /summary|pair/iu);
		db.prepare('UPDATE native_photo_smart_collection_summaries SET name=? WHERE collection_key=?').run(JSON.stringify(f.definitions[0]!.name), f.key(0));
		assert.throws(() => snapshot(db, () => pair(db, 'catalog', f.key(0), { ...f.root, keywords: [] })), ReferenceError);
		db.prepare('DELETE FROM native_photo_smart_collection_summaries WHERE collection_key=?').run(f.key(1));
		assert.throws(() => snapshot(db, () => pair(db, 'catalog', f.key(1), f.root)));
	} finally { db.close(); }
});

test('Lightscaper native saved zero-state guard independently checks canonical primary and scoped paths for both relations', () => {
	for (const table of ['native_photo_smart_collections', 'native_photo_smart_collection_summaries']) {
		const db = makeDatabase(); try {
			initialize(db); seed(db, 1); db.exec('PRAGMA ignore_check_constraints=ON; PRAGMA foreign_keys=OFF');
			db.prepare(`UPDATE ${table} SET catalog_id='other'`).run();
			db.exec('DELETE FROM native_photo_smart_collection_states');
			assert.throws(() => snapshot(db, () => capture(db, 'catalog', null)));
		} finally { db.close(); }
	}
});

test('Lightscaper native saved positive context refuses unequal first pairs and combined root/saved count overflow', () => {
	const db = makeDatabase(); try {
		initialize(db); const f = seed(db, 2);
		db.prepare('DELETE FROM native_photo_smart_collection_summaries WHERE collection_key=?').run(f.key(0));
		assert.throws(() => snapshot(db, () => capture(db, 'catalog', null)), /pair|missing|state/iu);
		db.prepare('INSERT INTO native_photo_smart_collection_summaries VALUES (?,?,?,?,?)').run(f.key(0), 'catalog', f.definitions[0]!.id, 2, JSON.stringify(f.definitions[0]!.name));
		db.exec('UPDATE native_photo_smart_collection_states SET collection_count=9999');
		assert.throws(() => snapshot(db, () => capture(db, 'catalog', null)), RangeError);
	} finally { db.close(); }
});


test('Lightscaper native saved name codec preserves exact legal UTF16 strings through actual SQLite and refuses noncanonical JSON strings', () => {
	const db = makeDatabase(); try {
		initialize(db); seed(db);
		const names = ['Plain', 'Quoted "name"', '😀', '\ud800', '\udc00', '\ud800'.repeat(256)];
		for (const [index, name] of names.entries()) insert(db, normalizePhotoSmartCollectionV1({ ...definition(index), name }));
		db.prepare('INSERT INTO native_photo_smart_collection_states VALUES (?,?,?)').run('catalog', 1, names.length);
		for (const [index, name] of names.entries()) {
			const d = definition(index), raw = db.prepare('SELECT * FROM native_photo_smart_collection_summaries WHERE collection_id=?').get(d.id);
			assert.equal(raw?.name, JSON.stringify(name)); assert.equal(readSummary(raw, 'catalog').name, name);
			assert.equal(snapshot(db, () => capture(db, 'catalog', d.id)).definition?.name, name);
		}
		assert.throws(() => readSummary(scalar({ name: '"\\u0053aved 0"' }), 'catalog'));
		assert.throws(() => readSummary(scalar({ name: 'null' }), 'catalog'));
		assert.throws(() => readSummary(scalar({ name: '[]' }), 'catalog'));
	} finally { db.close(); }
});
