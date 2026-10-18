/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativeCatalogPathsCurrentV1, initializeLightscaperNativeCatalogDatabaseCurrentV1,
	LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1, readLightscaperNativeCatalogRowCurrentV1,
	readLightscaperNativePhotoRowCurrentV1, readLightscaperNativeSummaryRowCurrentV1,
} from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { readValidatedPhotoCatalogRootV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { serializePhotoDocumentCurrentV1, upgradePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { indexState, photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const root = readValidatedPhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Native library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const rootRow = (value: unknown = root, changed: Record<string, unknown> = {}) => ({ id: root.id,
	document: serializeLightscaperDocumentV1(value), root_revision: root.revision, photo_count: root.photoCount, index_revision: 0, ...changed });
const photoRow = (photo = photoArchiveFixture().photo, changed: Record<string, unknown> = {}) => ({
	photo_key: photoStorageKey(photo.catalogId, photo.id), catalog_id: photo.catalogId, photo_id: photo.id, revision: photo.revision,
	document: serializePhotoDocumentCurrentV1(photo), summary: JSON.stringify(photoSummary(photo)), ...changed });
const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false, enableDoubleQuotedStringLiterals: false });
function insertRoot(database: DatabaseSync): void {
	const row = rootRow(); database.prepare('INSERT INTO native_photo_catalogs VALUES (?, ?, ?, ?, ?)')
		.run(row.id, row.document, row.root_revision, row.photo_count, row.index_revision);
}
function insertPhoto(database: DatabaseSync): void {
	const row = photoRow(); database.prepare('INSERT INTO native_photos VALUES (?, ?, ?, ?, ?, ?)')
		.run(row.photo_key, row.catalog_id, row.photo_id, row.revision, row.document, row.summary);
}
function scalar(database: DatabaseSync, sql: string, key: string) { return database.prepare(sql).get()?.[key]; }

test('Lightscaper native catalog derives its dedicated database beside the separate Original index', () => {
	const appData = resolve(tmpdir(), 'lightscaper-catalog-policy'), libraryRoot = join(appData, 'Lightscaper', 'project-library', 'v1');
	assert.deepEqual(deriveLightscaperNativeCatalogPathsCurrentV1(appData), { libraryRoot, databasePath: join(libraryRoot, 'native-photo-catalogs.sqlite3') });
	assert.ok(Object.isFrozen(deriveLightscaperNativeCatalogPathsCurrentV1(appData)));
	for (const invalid of ['', 'relative', `${appData}\0outside`]) assert.throws(() => deriveLightscaperNativeCatalogPathsCurrentV1(invalid));
	assert.equal(LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1, 0x4c534343);
	assert.notEqual(LIGHTSCAPER_NATIVE_CATALOG_APPLICATION_ID_CURRENT_V1, 0x4c534350);
});

test('Lightscaper native catalog initializes exactly its owned schema and enables real foreign-key enforcement', () => {
	const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.equal(scalar(database, 'PRAGMA application_id', 'application_id'), 0x4c534343);
		assert.equal(scalar(database, 'PRAGMA user_version', 'user_version'), 4);
		assert.equal(scalar(database, 'PRAGMA foreign_keys', 'foreign_keys'), 1);
		assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(value => value.name),
			['native_photo_catalogs', 'native_photo_memberships', 'native_photo_query_builds_v1', 'native_photo_query_builds_v2', 'native_photo_query_rows_v1', 'native_photo_query_rows_v2',
				'native_photo_stack_forward_members', 'native_photo_stack_memberships', 'native_photo_stack_states', 'native_photo_stacks', 'native_photos']);
		assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});

test('Lightscaper native catalog refuses unowned nonempty schemas including noninternal sqlite-like names', () => {
	for (const name of ['foreign_data', 'sqliteXforeign']) {
		const database = makeDatabase();
		try {
			database.exec(`CREATE TABLE ${name} (value TEXT); INSERT INTO ${name} VALUES ('unchanged')`);
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database));
			assert.equal(scalar(database, 'PRAGMA application_id', 'application_id'), 0);
			assert.equal(scalar(database, 'PRAGMA user_version', 'user_version'), 0);
			assert.equal(scalar(database, `SELECT value FROM ${name}`, 'value'), 'unchanged'); assert.equal(database.isTransaction, false);
		}
		finally { database.close(); }
	}
});

test('Lightscaper native catalog refuses foreign application, Original-index identity and adjacent schema versions', () => {
	for (const [application, version] of [[0x46534350, 1], [0x53534350, 1], [0x4c534350, 1], [0x4c534343, 5], [0, 1], [0x4c534343, 0]]) {
		const database = makeDatabase();
		try {
			database.exec(`PRAGMA application_id = ${application}; PRAGMA user_version = ${version}`);
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database));
			assert.equal(scalar(database, 'PRAGMA application_id', 'application_id'), application);
			assert.equal(scalar(database, 'PRAGMA user_version', 'user_version'), version);
			assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all(), []);
		} finally { database.close(); }
	}
});

test('Lightscaper native catalog refuses forged own constraints, missing indexes and extra executable schema', () => {
	for (const mutate of ['DROP INDEX native_photo_memberships_scope_key',
		'CREATE TABLE extra_payload (value TEXT)',
		'CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photo_catalogs BEGIN SELECT 1; END']) {
		const database = makeDatabase();
		try {
			initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec(mutate);
			const before = database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
			assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(database));
			assert.deepEqual(database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all(), before);
		} finally { database.close(); }
	}
	const forged = makeDatabase();
	try {
		forged.exec('PRAGMA application_id=1280525123; PRAGMA user_version=1; CREATE TABLE native_photo_catalogs(id TEXT PRIMARY KEY,document TEXT,root_revision INTEGER,photo_count INTEGER,index_revision INTEGER)');
		assert.throws(() => initializeLightscaperNativeCatalogDatabaseCurrentV1(forged));
	} finally { forged.close(); }
});

test('Lightscaper native catalog schema enforces canonical photo keys, scoped membership FKs and cascading retirement', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.throws(() => insertPhoto(database)); insertRoot(database); insertPhoto(database);
		const row = photoRow();
		assert.throws(() => database.prepare('INSERT INTO native_photo_memberships VALUES (?,?,?,?)').run('catalog-other|rating|0|photo-1', 'catalog-other|rating|0', row.photo_key, 'catalog-other'));
		database.prepare('INSERT INTO native_photo_memberships VALUES (?,?,?,?)').run('catalog-1|rating|0|photo-1', 'catalog-1|rating|0', row.photo_key, 'catalog-1');
		assert.throws(() => database.prepare('UPDATE native_photos SET photo_key = ? WHERE photo_key = ?').run('catalog-1|wrong', row.photo_key));
		database.prepare('DELETE FROM native_photo_catalogs WHERE id = ?').run(root.id);
		assert.equal(scalar(database, 'SELECT COUNT(*) AS count FROM native_photos', 'count'), 0);
		assert.equal(scalar(database, 'SELECT COUNT(*) AS count FROM native_photo_memberships', 'count'), 0);
	} finally { database.close(); }
});

test('Lightscaper native root reader binds actual native id, root revision, count and index revision atomically', () => {
	const snapshot = readLightscaperNativeCatalogRowCurrentV1(rootRow(), root.id);
	assert.deepEqual(snapshot, { root, index: indexState(root, 0) });
	assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.index));
	for (const changed of [{ id: 'other' }, { root_revision: 1 }, { photo_count: 1 }, { index_revision: -1 },
		{ index_revision: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }, { document: JSON.stringify({ ...root, schemaFamily: 'framescaper' }) }]) {
		assert.throws(() => readLightscaperNativeCatalogRowCurrentV1(rootRow(root, changed), root.id));
	}
	assert.throws(() => readLightscaperNativeCatalogRowCurrentV1(rootRow(), 'other'));
});

test('Lightscaper native readers reject accessor authority and oversized UTF-8 before parsing documents', () => {
	let invoked = false; const accessor = rootRow();
	Object.defineProperty(accessor, 'document', { enumerable: true, get() { invoked = true; return ''; } });
	assert.throws(() => readLightscaperNativeCatalogRowCurrentV1(accessor)); assert.equal(invoked, false);
	assert.throws(() => readLightscaperNativeCatalogRowCurrentV1(rootRow(root, { document: 'ä'.repeat(LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) })), RangeError);
	assert.throws(() => readLightscaperNativeSummaryRowCurrentV1({ ...photoRow(), document: undefined }));
});

test('Lightscaper native Photo readers retain exact Current1/2/3 aggregates without loading promotion', () => {
	const first = photoArchiveFixture().photo;
	for (const photo of [first, upgradePhotoDocumentV2(first), upgradePhotoDocumentCurrentV1(first)]) {
		const row = { ...photoRow(), document: serializePhotoDocumentCurrentV1(photo) };
		const restored = readLightscaperNativePhotoRowCurrentV1(row, photo.catalogId, photo.id);
		assert.deepEqual(restored, photo); assert.equal(restored.schemaVersion, photo.schemaVersion); assert.ok(Object.isFrozen(restored));
	}
});

test('Lightscaper native Photo readers reject mismatched key, scalar revision and valid-but-wrong summary projections', () => {
	for (const changed of [{ photo_key: 'catalog-1|another' }, { catalog_id: 'another' }, { photo_id: 'another' }, { revision: 1 },
		{ document: JSON.stringify({ ...photoArchiveFixture().photo, schemaVersion: 4 }) },
		{ summary: JSON.stringify({ ...photoSummary(photoArchiveFixture().photo), rating: 4 }) }]) {
		assert.throws(() => readLightscaperNativePhotoRowCurrentV1(photoRow(undefined, changed), 'catalog-1', 'photo-1'));
	}
	assert.throws(() => readLightscaperNativePhotoRowCurrentV1(photoRow(), 'catalog-other', 'photo-1'));
});

test('Lightscaper native scalar summary reader uses only bounded projections and validates native row identity', () => {
	const database = makeDatabase();
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(database); insertRoot(database); insertPhoto(database);
		database.prepare('UPDATE native_photos SET document = ?').run('{broken aggregate');
		const row = database.prepare('SELECT photo_key,catalog_id,photo_id,revision,summary FROM native_photos').get();
		assert.deepEqual(readLightscaperNativeSummaryRowCurrentV1(row, 'catalog-1'), photoSummary(photoArchiveFixture().photo));
		assert.throws(() => readLightscaperNativePhotoRowCurrentV1(database.prepare('SELECT * FROM native_photos').get()));
		assert.throws(() => readLightscaperNativeSummaryRowCurrentV1({ ...row, revision: 2 }, 'catalog-1'));
		assert.throws(() => readLightscaperNativeSummaryRowCurrentV1({ ...row, summary: ' '.repeat(4097) }, 'catalog-1'), RangeError);
	} finally { database.close(); }
});

test('Lightscaper native records survive actual SQLite close and fresh schema/record-reader reopen', async () => {
	const appData = await mkdtemp(join(tmpdir(), 'lightscaper-catalog-records-')); let database: DatabaseSync | undefined;
	try {
		const paths = deriveLightscaperNativeCatalogPathsCurrentV1(appData); await mkdir(paths.libraryRoot, { recursive: true });
		database = new DatabaseSync(paths.databasePath); initializeLightscaperNativeCatalogDatabaseCurrentV1(database); insertRoot(database); insertPhoto(database);
		database.close(); database = undefined; database = new DatabaseSync(paths.databasePath); initializeLightscaperNativeCatalogDatabaseCurrentV1(database);
		assert.deepEqual(readLightscaperNativeCatalogRowCurrentV1(database.prepare('SELECT * FROM native_photo_catalogs').get()).root, root);
		assert.deepEqual(readLightscaperNativePhotoRowCurrentV1(database.prepare('SELECT * FROM native_photos').get()), photoArchiveFixture().photo);
	} finally { database?.close(); await rm(appData, { recursive: true, force: false }); }
});
