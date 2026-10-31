/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { rebuildLightscaperNativeQueryIndexPageCurrentV1 as rebuild } from '../desktop/lightscaper-native-query-rebuild-current-v1.ts';
import { readLightscaperNativeQueryRowCurrentV1 } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 as build, writeLightscaperNativeQueryPhotoCurrentV1 as writeQuery } from '../desktop/lightscaper-native-query-write-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { PHOTO_QUERY_LIMITS_V2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const ID = 'catalog', QUERY = 'native_photo_query_rows_v2', BUILDS = 'native_photo_query_builds_v2';
const queryColumns = 'photo_key, catalog_id, photo_id, photo_revision, row_json, file_name_key, capture_bucket, capture_sort, rating_sort';
const root = (count: number) => normalizePhotoCatalogRootV1({ ...nativeCatalogRootCurrentV1(), photoCount: count, revision: 1,
	collections: nativeCatalogRootCurrentV1().collections.filter(value => value.kind === 'manual') });
const mixed = (index: number) => normalizePhotoDocumentCurrentV1({ ...nativePhotoCurrentV1(index), schemaVersion: 1 + index % 3 });

/** Real SQLite source fixtures only. This derived-index suite does not claim
 * image/body custody; the native Original owner has its independent tests. */
function seeded(values: readonly PhotoDocumentCurrentV1[] = Array.from({ length: 20 }, (_, index) => mixed(index)), path = ':memory:') {
	const database = new DatabaseSync(path, { timeout: 20 }); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
	database.exec('BEGIN IMMEDIATE');
	try {
		const catalog = root(values.length);
		database.prepare('INSERT INTO native_photo_catalogs (id, document, root_revision, photo_count, index_revision) VALUES (?, ?, 1, ?, 1)')
			.run(ID, serializeLightscaperDocumentV1(catalog), values.length);
		for (const photo of values) writeSource(database, photo);
		database.prepare(`INSERT INTO ${BUILDS} (catalog_id, ready, after_key, indexed_count) VALUES (?, 0, NULL, 0)`).run(ID);
		database.exec('COMMIT'); return database;
	} catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); database.close(); throw error; }
}
function writeSource(database: DatabaseSync, photo: PhotoDocumentCurrentV1): void {
	database.prepare('INSERT INTO native_photos (photo_key, catalog_id, photo_id, revision, document, summary) VALUES (?, ?, ?, ?, ?, ?)')
		.run(photoStorageKey(photo.catalogId, photo.id), photo.catalogId, photo.id, photo.revision,
			serializePhotoDocumentCurrentV1(photo), JSON.stringify(photoSummary(photo)));
}
const count = (database: DatabaseSync) => Number(database.prepare(`SELECT COUNT(*) AS count FROM ${QUERY} WHERE catalog_id = ?`).get(ID)?.count);
const sources = (database: DatabaseSync) => database.prepare('SELECT photo_key, document, summary FROM native_photos ORDER BY photo_key').all();
const rows = (database: DatabaseSync) => database.prepare(`SELECT ${queryColumns} FROM ${QUERY} ORDER BY photo_key`).all().map(value => readLightscaperNativeQueryRowCurrentV1(value));
function step(database: DatabaseSync, operation: () => void): void {
	database.exec('BEGIN IMMEDIATE');
	try { operation(); database.exec('COMMIT'); } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
}

test('Lightscaper native Query2 rebuild bounds actual SQLite pages and keeps exact Current1/2/3 sources', () => {
	const values = Array.from({ length: 65 }, (_, index) => mixed(index)), database = seeded(values);
	try {
		const before = sources(database); let pages = 0, ready = false;
		while (!ready) {
			const result = rebuild(database, ID); pages++;
			assert.ok(result.processed <= 16); assert.ok(result.bytes + result.derivedBytes <= PHOTO_QUERY_LIMITS_V2.rebuildBytes);
			ready = result.ready;
		}
		assert.equal(pages, 5); assert.equal(count(database), 65);
		assert.deepEqual(rows(database), values.map(projectPhotoQueryRowV2)); assert.deepEqual(sources(database), before);
		assert.deepEqual(rebuild(database, ID), { processed: 0, bytes: 0, derivedBytes: 0, ready: true });
	} finally { database.close(); }
});

test('Lightscaper native Query2 exact sixteen-row page needs a later source exhaustion probe before ready', () => {
	const database = seeded(Array.from({ length: 16 }, (_, index) => mixed(index)));
	try {
		assert.equal(rebuild(database, ID).ready, false); assert.equal(build(database, ID)?.indexedCount, 16);
		assert.deepEqual(rebuild(database, ID), { processed: 0, bytes: 0, derivedBytes: 0, ready: true });
	} finally { database.close(); }
});

test('Lightscaper native Query2 empty source becomes ready without Original or resource services', () => {
	const database = seeded([]);
	try { assert.deepEqual(rebuild(database, ID), { processed: 0, bytes: 0, derivedBytes: 0, ready: true }); }
	finally { database.close(); }
});

test('Lightscaper native Query2 combined byte budget stops before the next legal rich Current aggregate', () => {
	const effects = Array.from({ length: 95 }, (_, index) => ({ id: `effect-${String(index)}-${'x'.repeat(100)}`, type: 'color-adjust', enabled: true, params: {} }));
	const values = Array.from({ length: 8 }, (_, index) => {
		const base = mixed(index), master = base.versions[0]!;
		return normalizePhotoDocumentCurrentV1({ ...base, activeVersionId: 'version-0', versions: Array.from({ length: 64 }, (_, version) => ({
			...master, id: `version-${String(version)}`, kind: version === 0 ? 'master' : 'virtual-copy', develop: { ...master.develop, effects } })) });
	});
	const sourceBytes = values.map(value => Buffer.byteLength(serializePhotoDocumentCurrentV1(value)));
	const derivedBytes = values.map(value => Buffer.byteLength(JSON.stringify(projectPhotoQueryRowV2(value))));
	let expected = 0, expectedBytes = 0, expectedDerived = 0;
	while (expected < values.length && expectedBytes + expectedDerived + sourceBytes[expected]! + derivedBytes[expected]! <= PHOTO_QUERY_LIMITS_V2.rebuildBytes) {
		expectedBytes += sourceBytes[expected]!; expectedDerived += derivedBytes[expected]!; expected++;
	}
	assert.ok(expected > 0 && expected < values.length);
	const database = seeded(values);
	try {
		assert.deepEqual(rebuild(database, ID), { processed: expected, bytes: expectedBytes, derivedBytes: expectedDerived, ready: false });
		assert.equal(build(database, ID)?.afterKey, photoStorageKey(ID, values[expected - 1]!.id));
		assert.equal(count(database), expected);
	} finally { database.close(); }
});

test('Lightscaper native Query2 progress reopens from actual disk and resumes from its committed cursor', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper query resume '))), path = join(directory, 'catalog.sqlite3');
	let database = seeded(undefined, path);
	try {
		assert.equal(rebuild(database, ID).processed, 16); const previous = build(database, ID); database.close();
		database = new DatabaseSync(path); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.deepEqual(build(database, ID), previous); assert.equal(count(database), 16);
		const result = rebuild(database, ID); assert.equal(result.processed, 4); assert.equal(result.ready, true); assert.equal(count(database), 20);
	} finally { database.close(); await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native Query2 later source corruption rolls back only the current bounded page', () => {
	const database = seeded();
	try {
		rebuild(database, ID); const previous = build(database, ID);
		database.prepare("UPDATE native_photos SET document = '{}' WHERE photo_id = ?").run(mixed(18).id);
		assert.throws(() => rebuild(database, ID)); assert.equal(count(database), 16); assert.deepEqual(build(database, ID), previous);
		assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});

test('Lightscaper native Query2 final progress SQL failure rolls back derived rows and cursor together', () => {
	const database = seeded();
	try {
		rebuild(database, ID); const previous = build(database, ID);
		database.exec(`CREATE TRIGGER refuse_query_progress BEFORE UPDATE ON ${BUILDS} WHEN NEW.after_key IS NOT OLD.after_key BEGIN SELECT RAISE(ABORT, 'owned rebuild progress failure'); END`);
		assert.throws(() => rebuild(database, ID), /owned rebuild progress failure/u);
		assert.equal(count(database), 16); assert.deepEqual(build(database, ID), previous); assert.equal(database.isTransaction, false);
		database.exec('DROP TRIGGER refuse_query_progress'); assert.equal(rebuild(database, ID).ready, true);
	} finally { database.close(); }
});

test('Lightscaper native Query2 missing build and scalar count inconsistencies refuse before publication', () => {
	for (const fault of ['missing', 'overflow', 'ready-count'] as const) {
		const database = seeded();
		try {
			if (fault === 'missing') database.exec(`DELETE FROM ${BUILDS}`);
			else database.exec(`UPDATE ${BUILDS} SET indexed_count = ${fault === 'overflow' ? '21' : '0'}, ready = ${fault === 'ready-count' ? '1' : '0'}`);
			assert.throws(() => rebuild(database, ID)); assert.equal(count(database), 0); assert.equal(database.isTransaction, false);
		} finally { database.close(); }
	}
});

test('Lightscaper native Query2 missing cursor source or query anchor cannot silently skip coverage', () => {
	for (const table of ['native_photos', QUERY]) {
		const database = seeded();
		try {
			rebuild(database, ID); const previous = build(database, ID)!;
			database.prepare(`DELETE FROM ${table} WHERE photo_key = ?`).run(previous.afterKey);
			assert.throws(() => rebuild(database, ID)); assert.deepEqual(build(database, ID), previous);
			assert.equal(count(database), 15); assert.equal(database.isTransaction, false);
		} finally { database.close(); }
	}
});

test('Lightscaper native Query2 final source exhaustion authenticates physical row count before readiness', () => {
	const database = seeded();
	try {
		rebuild(database, ID); const previous = build(database, ID);
		database.prepare(`DELETE FROM ${QUERY} WHERE photo_key = ?`).run(photoStorageKey(ID, mixed(0).id));
		assert.throws(() => rebuild(database, ID), /count|coverage/iu);
		assert.equal(count(database), 15); assert.deepEqual(build(database, ID), previous);
	} finally { database.close(); }
});

test('Lightscaper native Query2 native cancellation before commit preserves opaque reason and rolls back actual SQL', () => {
	const database = seeded(), stop = new AbortController(); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw Error('Reason read'); }, getPrototypeOf() { inspected++; throw Error('Reason prototype read'); } });
	try {
		// Test-owned native SQLite fault injection only; production rebuild has
		// no supplied callbacks or signal getters inside its SQL transaction.
		database.function('owned_abort_rebuild', () => { stop.abort(reason); return 0; });
		database.exec(`CREATE TRIGGER abort_query_step AFTER INSERT ON ${QUERY} BEGIN SELECT owned_abort_rebuild(); END`);
		let failure: unknown; try { rebuild(database, ID, { signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(inspected, 0); assert.equal(count(database), 0);
		assert.equal(build(database, ID)?.afterKey, null); assert.equal(build(database, ID)?.indexedCount, 0); assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});

test('Lightscaper native Query2 refuses preabort and overridden cancellation without invoking borrowed getters', () => {
	const database = seeded(), aborted = new AbortController(), overridden = new AbortController(); let getters = 0;
	try {
		aborted.abort(); assert.throws(() => rebuild(database, ID, { signal: aborted.signal }), { name: 'AbortError' });
		Object.defineProperty(overridden.signal, 'throwIfAborted', { get() { getters++; throw Error('Borrowed signal getter'); } });
		assert.throws(() => rebuild(database, ID, { signal: overridden.signal }), TypeError);
		assert.equal(getters, 0); assert.equal(count(database), 0); assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});

test('Lightscaper native Query2 two actual connections retain edited rows before and after a partial cursor', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper query writers '))), path = join(directory, 'catalog.sqlite3');
	const first = seeded(undefined, path), second = new DatabaseSync(path, { timeout: 20 });
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(second); rebuild(first, ID);
		const changed = [2, 18].map(index => normalizePhotoDocumentCurrentV1({ ...mixed(index), revision: 1, rating: 5,
			metadata: { ...mixed(index).metadata, title: `Edited ${String(index)}` } }));
		step(second, () => {
			for (const value of changed) {
				second.prepare('UPDATE native_photos SET revision = ?, document = ?, summary = ? WHERE photo_key = ?')
					.run(value.revision, serializePhotoDocumentCurrentV1(value), JSON.stringify(photoSummary(value)), photoStorageKey(ID, value.id));
				writeQuery(second, value, 'replace');
			}
			second.prepare('UPDATE native_photo_catalogs SET index_revision = index_revision + 1 WHERE id = ?').run(ID);
		});
		assert.equal(build(first, ID)?.indexedCount, 17); assert.equal(rebuild(first, ID).ready, true); assert.equal(count(first), 20);
		for (const value of changed) assert.deepEqual(rows(first).find(row => row.photoId === value.id), projectPhotoQueryRowV2(value));
	} finally { second.close(); first.close(); await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native Query2 actual inserted source behind cursor remains covered by its atomic write bridge', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper query insert '))), path = join(directory, 'catalog.sqlite3');
	const first = seeded(undefined, path), second = new DatabaseSync(path);
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(second); rebuild(first, ID);
		const extra = normalizePhotoDocumentCurrentV1({ ...mixed(21), id: 'photo-000000a' });
		assert.ok(photoStorageKey(ID, extra.id) < build(first, ID)!.afterKey!);
		step(second, () => {
			writeSource(second, extra); writeQuery(second, extra, 'insert');
			const next = { ...root(21), revision: 2 };
			second.prepare('UPDATE native_photo_catalogs SET document = ?, root_revision = 2, photo_count = 21, index_revision = 2 WHERE id = ?')
				.run(serializeLightscaperDocumentV1(next), ID);
		});
		assert.equal(build(first, ID)?.indexedCount, 17);
		assert.equal(rebuild(first, ID).ready, true); assert.equal(count(first), 21);
		assert.deepEqual(rows(first).find(value => value.photoId === extra.id), projectPhotoQueryRowV2(extra));
	} finally { second.close(); first.close(); await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native Query2 ready fast path keeps its declared scalar trust boundary without reparsing sources', () => {
	const database = seeded([mixed(0)]);
	try {
		assert.equal(rebuild(database, ID).ready, true);
		// A ready index is maintained by trusted atomic writers. This call is
		// not a full forensic audit of subsequently damaged source documents.
		database.prepare("UPDATE native_photos SET document = '{}' WHERE photo_id = ?").run(mixed(0).id);
		assert.deepEqual(rebuild(database, ID), { processed: 0, bytes: 0, derivedBytes: 0, ready: true });
	} finally { database.close(); }
});

test('Lightscaper native Query2 respects actual competing SQLite immediate writer ownership', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper query locked '))), path = join(directory, 'catalog.sqlite3');
	const first = seeded(undefined, path), second = new DatabaseSync(path, { timeout: 20 });
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(second); first.exec('BEGIN IMMEDIATE');
		assert.throws(() => rebuild(second, ID), /locked|busy/iu); assert.equal(second.isTransaction, false); assert.equal(count(second), 0);
		first.exec('ROLLBACK'); assert.equal(rebuild(second, ID).processed, 16);
	} finally { if (first.isTransaction) first.exec('ROLLBACK'); second.close(); first.close(); await rm(directory, { recursive: true, force: false }); }
});
