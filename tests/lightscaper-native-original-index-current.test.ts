/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1,
	LightscaperNativePhotoOriginalIndexCurrentV1, LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1,
} from '../desktop/lightscaper-native-original-index-current-v1.ts';

const original = Object.freeze({ schemaVersion: 1, kind: 'still', id: 'source-one', name: 'Original ü.png',
	mimeType: 'image/png', storageKey: 'asset-one', contentSha256: 'a'.repeat(64), width: 3, height: 2,
	hasAlpha: true, byteLength: 25, retention: 'managed' } as const);
const expected = Object.freeze({ storageKey: original.storageKey, byteLength: original.byteLength, contentSha256: original.contentSha256 });
const makeDatabase = () => new DatabaseSync(':memory:', { allowExtension: false,
	enableDoubleQuotedStringLiterals: false, enableForeignKeyConstraints: true });
const scalar = (database: DatabaseSync, sql: string, key: string) => database.prepare(sql).get()?.[key];

test('Lightscaper native Original paths have a fixed product scope and SHA-only sharded bodies', () => {
	const root = resolve(tmpdir(), 'lightscaper-path-policy');
	const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(root);
	const libraryRoot = join(root, 'Lightscaper', 'project-library', 'v1');
	assert.deepEqual(paths, { libraryRoot, databasePath: join(libraryRoot, 'native-photo-originals.sqlite3'),
		bodiesRoot: join(libraryRoot, 'native-photo-originals'), stagingRoot: join(libraryRoot, 'native-photo-originals-staging') });
	assert.ok(Object.isFrozen(paths));
	assert.equal(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, original.contentSha256),
		join(paths.bodiesRoot, 'aa', `${original.contentSha256}.body`));
	for (const invalid of ['', 'relative', `${root}\0ignored`]) assert.throws(() => deriveLightscaperNativePhotoOriginalPathsCurrentV1(invalid));
	for (const invalid of ['../escape', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(64)}/x`]) {
		assert.throws(() => lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, invalid));
	}
});

test('Lightscaper native Original index initializes only its exact SQLite identity and empty lookup', () => {
	const database = makeDatabase();
	try {
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
		assert.equal(scalar(database, 'PRAGMA application_id', 'application_id'), LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1);
		assert.equal(scalar(database, 'PRAGMA user_version', 'user_version'), 2);
		assert.equal(index.get('asset-missing'), null);
		assert.throws(() => index.get('../outside'));
		assert.throws(() => index.get(''));
	} finally { database.close(); }
});

test('Lightscaper native Original index persists only immutable physical custody and returns frozen readback', () => {
	const database = makeDatabase();
	try {
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
		assert.equal(index.putIfAbsent(original), 'inserted'); assert.equal(index.putIfAbsent({ ...original }), 'same');
		const stored = index.get(original.storageKey); assert.deepEqual(stored, expected); assert.ok(Object.isFrozen(stored));
		assert.deepEqual(Object.keys(stored ?? {}).sort(), ['byteLength', 'contentSha256', 'storageKey']);
		assert.equal(scalar(database, 'SELECT COUNT(*) AS count FROM native_photo_original_bindings', 'count'), 1);
	} finally { database.close(); }
});

test('Lightscaper native Original dedup aliases preserve body binding while allowing distinct catalog metadata', () => {
	const database = makeDatabase();
	try {
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database); index.putIfAbsent(original);
		assert.equal(index.putIfAbsent({ ...original, id: 'source-alias', name: 'Different name.jpg', mimeType: 'image/jpeg',
			width: 6, height: 1, hasAlpha: false }), 'same');
		for (const change of [{ contentSha256: 'b'.repeat(64) }, { byteLength: original.byteLength + 1 }]) {
			assert.throws(() => index.putIfAbsent({ ...original, ...change }));
			assert.deepEqual(index.get(original.storageKey), expected);
		}
	} finally { database.close(); }
});

test('Lightscaper native Original index rejects linked, path-bearing and malformed descriptors before insertion', () => {
	const database = makeDatabase();
	try {
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
		for (const change of [{ retention: 'linked' }, { path: '/outside/original.png' }, { storageKey: '../outside' },
			{ contentSha256: 'A'.repeat(64) }, { byteLength: 0 }, { byteLength: Number.MAX_SAFE_INTEGER }]) {
			assert.throws(() => index.putIfAbsent({ ...original, ...change }));
		}
		assert.equal(index.get(original.storageKey), null);
	} finally { database.close(); }
});

test('Lightscaper native Original index refuses an unowned nonempty SQLite database without schema mutation', () => {
	const database = makeDatabase();
	try {
		database.exec('CREATE TABLE foreign_data (value TEXT); INSERT INTO foreign_data VALUES (\'keep\')');
		assert.throws(() => new LightscaperNativePhotoOriginalIndexCurrentV1(database));
		assert.equal(scalar(database, 'PRAGMA application_id', 'application_id'), 0);
		assert.equal(scalar(database, 'PRAGMA user_version', 'user_version'), 0);
		assert.equal(scalar(database, 'SELECT value FROM foreign_data', 'value'), 'keep');
		assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name), ['foreign_data']);
	} finally { database.close(); }
});

test('Lightscaper native Original index refuses foreign application, adjacent schema and forged own schema', () => {
	for (const setup of ['PRAGMA application_id = 1179861840', `PRAGMA application_id = ${LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1}; PRAGMA user_version = 3`,
		`PRAGMA application_id = ${LIGHTSCAPER_NATIVE_PHOTO_ORIGINAL_APPLICATION_ID_CURRENT_V1}; PRAGMA user_version = 1; CREATE TABLE native_photo_original_bindings (storage_key TEXT PRIMARY KEY, content_sha256 TEXT, byte_length INTEGER)`]) {
		const database = makeDatabase();
		try { database.exec(setup); assert.throws(() => new LightscaperNativePhotoOriginalIndexCurrentV1(database)); }
		finally { database.close(); }
	}
});

test('Lightscaper native Original readback rejects corrupted stored key, SHA and byte-length metadata', () => {
	const database = makeDatabase();
	try {
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database); index.putIfAbsent(original);
		database.exec('PRAGMA ignore_check_constraints = ON');
		for (const [column, invalid, valid] of [['content_sha256', 'broken', original.contentSha256],
			['byte_length', -1, original.byteLength]] as const) {
			database.prepare(`UPDATE native_photo_original_bindings SET ${column} = ? WHERE storage_key = ?`).run(invalid, original.storageKey);
			assert.throws(() => index.get(original.storageKey));
			database.prepare(`UPDATE native_photo_original_bindings SET ${column} = ? WHERE storage_key = ?`).run(valid, original.storageKey);
		}
		database.prepare('UPDATE native_photo_original_bindings SET storage_key = ? WHERE storage_key = ?').run('../outside', original.storageKey);
		assert.throws(() => index.get('../outside')); assert.equal(index.get(original.storageKey), null);
	} finally { database.close(); }
});

test('Lightscaper native Original publication checks actual saved binding and rolls back a changed readback', () => {
	const database = makeDatabase();
	try {
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
		database.exec(`CREATE TRIGGER alter_inserted_binding AFTER INSERT ON native_photo_original_bindings BEGIN
			UPDATE native_photo_original_bindings SET byte_length = NEW.byte_length + 1 WHERE storage_key = NEW.storage_key; END`);
		assert.throws(() => index.putIfAbsent(original));
		assert.equal(index.get(original.storageKey), null); assert.equal(database.isTransaction, false);
	} finally { database.close(); }
});

test('Lightscaper native Original binding survives a real SQLite close and fresh owner reopen with dedup alias', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper-original-index-'));
	let database: DatabaseSync | null = null;
	try {
		const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(root); await mkdir(paths.libraryRoot, { recursive: true });
		database = new DatabaseSync(paths.databasePath); new LightscaperNativePhotoOriginalIndexCurrentV1(database).putIfAbsent(original);
		database.close(); database = null; database = new DatabaseSync(paths.databasePath);
		const index = new LightscaperNativePhotoOriginalIndexCurrentV1(database);
		assert.deepEqual(index.get(original.storageKey), expected);
		assert.equal(index.putIfAbsent({ ...original, id: 'source-reopened', name: 'Alias after reopen.png' }), 'same');
	} finally { database?.close(); await rm(root, { recursive: true, force: false }); }
});
