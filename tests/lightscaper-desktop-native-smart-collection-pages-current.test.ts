/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { readLightscaperNativeSmartCollectionPageCurrentV1 as page, readLightscaperNativeSmartCollectionSnapshotCurrentV1 as snapshot,
	admitLightscaperNativeSmartCollectionPageCurrentV1 as admitPage, readAdmittedLightscaperNativeSmartCollectionPageCurrentV1 as admittedPage } from '../desktop/lightscaper-native-smart-collection-pages-current-v1.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { PhotoSmartCollectionRevisionConflictError } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { photoSmartCollectionSummaryV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { seedNativeSmartCollectionFixtureCurrentV1 as seed } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';

const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false });
function scalarsOnly(db: DatabaseSync): void {
	db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && table === 'native_photo_smart_collections'
		&& (column === 'document' || column === 'reference_keys') ? constants.SQLITE_DENY : constants.SQLITE_OK);
}

test('Lightscaper native saved summary65 pages retain scalar-only bounded ordered records and all three epoch fences', () => {
	const db = makeDatabase(); try {
		initialize(db); const f = seed(db, 65); scalarsOnly(db);
		const first = page(db, 'catalog'); assert.deepEqual(first.items, f.definitions.slice(0, 64).map(photoSmartCollectionSummaryV1));
		assert.equal(first.items.length, 64); assert.ok(Buffer.byteLength(JSON.stringify(first.items)) <= 262_144);
		assert.equal(first.continuation?.afterKey, f.key(63)); assert.equal(first.continuation?.catalogRevision, 3);
		assert.equal(first.continuation?.indexRevision, 11); assert.equal(first.continuation?.stateRevision, 7);
		const last = page(db, 'catalog', { continuation: JSON.parse(JSON.stringify(first.continuation)) as unknown });
		assert.deepEqual(last.items, [photoSmartCollectionSummaryV1(f.definitions[64])]); assert.equal(last.continuation, null);
		assert.deepEqual(Object.keys(first).sort(), ['continuation', 'items']); assert.ok(Object.isFrozen(first.items)); assert.equal(db.isTransaction, false);
	} finally { db.setAuthorizer(null); db.close(); }
});

test('Lightscaper native saved exact64 summary page keeps a legitimate terminal empty step and creation snapshot never loads a recipe', () => {
	const db = makeDatabase(); try {
		initialize(db); seed(db, 64); scalarsOnly(db); const first = page(db, 'catalog');
		assert.equal(first.items.length, 64); assert.ok(first.continuation); assert.deepEqual(page(db, 'catalog', { continuation: first.continuation }), { items: [], continuation: null });
		const value = snapshot(db, 'catalog', null); assert.equal(value.definition, null); assert.equal(value.selectedId, null);
		assert.deepEqual(value.context, { catalogId: 'catalog', catalogRevision: 3, indexRevision: 11, collectionStateRevision: 7, collectionCount: 64 });
		assert.equal(db.isTransaction, false);
	} finally { db.setAuthorizer(null); db.close(); }
});

test('Lightscaper native saved scalar continuations fence root index and state epochs and reject borrowed or forged admission', () => {
	for (const epoch of ['root', 'index', 'state']) {
		const db = makeDatabase(); try {
			initialize(db); const f = seed(db, 65), first = page(db, 'catalog'); assert.ok(first.continuation);
			if (epoch === 'root') db.prepare('UPDATE native_photo_catalogs SET root_revision=4,document=?').run(serializeLightscaperDocumentV1({ ...f.root, revision: 4 }));
			else if (epoch === 'index') db.exec('UPDATE native_photo_catalogs SET index_revision=12');
			else db.exec('UPDATE native_photo_smart_collection_states SET revision=8');
			assert.throws(() => page(db, 'catalog', { continuation: first.continuation }), PhotoSmartCollectionRevisionConflictError);
		} finally { db.close(); }
	}
	const db = makeDatabase(); try {
		initialize(db); seed(db); let invoked = 0;
		assert.throws(() => admitPage('catalog', { get continuation() { invoked++; return null; } })); assert.equal(invoked, 0);
		assert.throws(() => admittedPage(db, { ...admitPage('catalog') }));
		db.setAuthorizer(() => constants.SQLITE_DENY); assert.throws(() => page(db, 'catalog', { query: {} }), TypeError);
	} finally { db.setAuthorizer(null); db.close(); }
});

test('Lightscaper native saved summary page refuses a later orphan without reading definition payloads', () => {
	const db = makeDatabase(); try {
		initialize(db); const f = seed(db, 65), first = page(db, 'catalog');
		db.prepare('DELETE FROM native_photo_smart_collections WHERE collection_key=?').run(f.key(64)); scalarsOnly(db);
		assert.throws(() => page(db, 'catalog', { continuation: first.continuation }), /orphan|missing|pair/iu); assert.equal(db.isTransaction, false);
	} finally { db.setAuthorizer(null); db.close(); }
});

test('Lightscaper native saved selected recipe summary and root/index/state share one actual WAL snapshot across a competing commit', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper saved snapshot ')); let reader: DatabaseSync | undefined, writer: DatabaseSync | undefined;
	try {
		const path = join(directory, 'catalog.sqlite3'); reader = new DatabaseSync(path); reader.exec('PRAGMA journal_mode=WAL'); initialize(reader);
		const f = seed(reader, 1); writer = new DatabaseSync(path); initialize(writer); const next = { ...f.definitions[0]!, revision: 3, name: 'Competing name' }; let fired = false;
		reader.setAuthorizer((action, table, column) => {
			if (!fired && action === constants.SQLITE_READ && table === 'native_photo_smart_collections' && column === 'document') {
				fired = true; writer!.exec('BEGIN IMMEDIATE');
				try {
					writer!.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4,index_revision=12').run(serializeLightscaperDocumentV1({ ...f.root, revision: 4 }));
					writer!.exec('UPDATE native_photo_smart_collection_states SET revision=8');
					writer!.prepare('UPDATE native_photo_smart_collections SET revision=3,document=?').run(JSON.stringify(next));
					writer!.prepare('UPDATE native_photo_smart_collection_summaries SET revision=3,name=?').run(JSON.stringify(next.name)); writer!.exec('COMMIT');
				} catch (error) { if (writer!.isTransaction) writer!.exec('ROLLBACK'); throw error; }
			}
			return constants.SQLITE_OK;
		});
		const old = snapshot(reader, 'catalog', f.definitions[0]!.id); reader.setAuthorizer(null);
		assert.equal(fired, true); assert.deepEqual(old.definition, f.definitions[0]); assert.equal(old.context.catalogRevision, 3); assert.equal(old.context.collectionStateRevision, 7);
		const fresh = snapshot(reader, 'catalog', f.definitions[0]!.id); assert.deepEqual(fresh.definition, next);
		assert.equal(fresh.context.catalogRevision, 4); assert.equal(fresh.context.indexRevision, 12); assert.equal(fresh.context.collectionStateRevision, 8);
	} finally { if (reader?.isOpen) { reader.setAuthorizer(null); reader.close(); } writer?.close(); await rm(directory, { recursive: true, force: false }); }
});
