/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativePhotoMediaDatabaseCurrentV1 as initialize,
	inspectLightscaperNativePhotoMediaDatabaseCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-media-schema-current-v1.ts';
import { initializeHistoricalLightscaperOriginalV1Current as historicalV1 } from './helpers/lightscaper-native-original-v1-fixture-current.ts';
import { initializeHistoricalLightscaperOriginalV2Current as historicalV2,
	LIGHTSCAPER_ORIGINAL_V2_DDL_FIXTURE_CURRENT as V2 } from './helpers/lightscaper-native-original-v2-fixture-current.ts';
import { originalHeadFixtureCurrentV1 as fixture, ORIGINAL_HEAD_TEST_OPTIONS_CURRENT_V1 as options,
	ORIGINAL_HEAD_SHA_CURRENT_V1 as SHA } from './helpers/lightscaper-native-original-head-fixture-current.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const objects = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
function seedHistoricalV2(db: DatabaseSync): void {
	db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('original', SHA, 3);
	db.prepare('INSERT INTO native_photo_media_assets VALUES(?,?,?,?,?,?,?,?)').run('original', SHA, 3, 'media-content-0123456789abcdef',
		Uint8Array.of(0, 255, 2, 3), 1, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z');
	db.prepare('INSERT INTO native_photo_media_roots VALUES(?,?,?,?)').run(Uint8Array.of(0, 1), Uint8Array.of(0, 2), 'original', '{}');
}

void test('Lightscaper LSCP3 owns exact STRICT head/locator inventory and preserved historical DDL', options, async t => {
	await fixture(t, db => {
		assert.equal(inspect(db), 'empty'); initialize(db); assert.equal(inspect(db), 'owned');
		assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 3);
		assert.deepEqual(objects(db).map(row => [row.type, row.name]), [
			['index', 'native_photo_media_assets_digest'], ['index', 'native_photo_media_roots_asset'], ['index', 'native_photo_media_roots_scope'],
			['index', 'native_photo_original_bindings_digest'], ['table', 'native_photo_media_assets'], ['table', 'native_photo_media_roots'],
			['table', 'native_photo_original_bindings'], ['table', 'native_photo_original_body_heads'], ['table', 'native_photo_original_body_locators'],
		]);
		for (const table of ['native_photo_original_body_heads', 'native_photo_original_body_locators']) {
			assert.equal(db.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(table)?.strict, 1);
		}
		for (const sql of V2) assert.ok(objects(db).some(row => row.sql === sql));
		const before = objects(db); initialize(db); assert.deepEqual(objects(db), before);
	});
});

for (const version of [1, 2] as const) void test(`Lightscaper exact historical LSCP${version} migrates/reopens without body IO or row rewrites`, options, async t => {
	await fixture(t, async (db, path, directory) => {
		if (version === 1) { historicalV1(db); db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('original', SHA, 3); }
		else { historicalV2(db); seedHistoricalV2(db); }
		const prior = objects(db), binding = db.prepare('SELECT * FROM native_photo_original_bindings').all();
		const asset = version === 2 ? db.prepare('SELECT source_id,sha256,size,media_content_token,hex(metadata) AS metadata,root_count,committed_at,pending_until FROM native_photo_media_assets').all() : [];
		const roots = version === 2 ? db.prepare('SELECT hex(root_key) AS root_key,hex(scope_key) AS scope_key,asset_id,root FROM native_photo_media_roots').all() : [];
		const bodyPath = join(directory, 'independent.body'); await writeFile(bodyPath, Uint8Array.of(1, 2, 3));
		const execute = db.exec; let creatingEmptyRoots = false;
		db.exec = function (sql: string): void {
			creatingEmptyRoots = version === 1 && sql === V2[2];
			try { execute.call(this, sql); } finally { creatingEmptyRoots = false; }
		};
		db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ &&
			((table === 'native_photo_media_assets' && column === 'metadata') || (!creatingEmptyRoots && table === 'native_photo_media_roots' && column === 'root')) ? constants.SQLITE_DENY : constants.SQLITE_OK);
		try { initialize(db); } finally { db.setAuthorizer(null); db.exec = execute; }
		assert.equal(inspect(db), 'owned'); assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 3);
		assert.deepEqual(db.prepare('SELECT * FROM native_photo_original_bindings').all(), binding);
		assert.deepEqual(db.prepare('SELECT source_id,sha256,size,media_content_token,hex(metadata) AS metadata,root_count,committed_at,pending_until FROM native_photo_media_assets').all(), asset);
		assert.deepEqual(db.prepare('SELECT hex(root_key) AS root_key,hex(scope_key) AS scope_key,asset_id,root FROM native_photo_media_roots').all(), roots);
		for (const row of prior) assert.ok(objects(db).some(value => value.sql === row.sql));
		assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
		assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_original_body_locators').get()?.n, 0);
		assert.equal(hash(await readFile(bodyPath)), hash(Uint8Array.of(1, 2, 3)));
		const reopened = new DatabaseSync(path); try { initialize(reopened); assert.equal(inspect(reopened), 'owned'); } finally { reopened.close(); }
	});
});

for (const version of [1, 2] as const) void test(`Lightscaper LSCP${version} readonly preflight leaves all real primary bytes unchanged`, options, async t => {
	await fixture(t, async (db, path) => {
		(version === 1 ? historicalV1 : historicalV2)(db);
		const before = hash(await readFile(path)), reader = new DatabaseSync(path, { readOnly: true });
		try { assert.equal(inspect(reader), version === 1 ? 'original-v1' : 'media-v2'); } finally { reader.close(); }
		assert.equal(hash(await readFile(path)), before);
	});
});

for (const kind of ['foreign', 'wrong-app', 'future', 'extra-table', 'extra-trigger', 'weakened'] as const) void test(`Lightscaper LSCP3 refuses ${kind} schema without changing primary bytes`, options, async t => {
	await fixture(t, async (db, path) => {
		if (kind === 'foreign') db.exec('CREATE TABLE foreign_bytes(value TEXT)');
		else if (kind === 'weakened') db.exec('PRAGMA application_id=1280525136; PRAGMA user_version=2; CREATE TABLE native_photo_original_bindings(storage_key TEXT)');
		else { historicalV2(db); if (kind === 'wrong-app') db.exec('PRAGMA application_id=1');
			else if (kind === 'future') db.exec('PRAGMA user_version=4');
			else db.exec(kind === 'extra-table' ? 'CREATE TABLE extra_bytes(value TEXT)' : 'CREATE TRIGGER extra_trigger AFTER INSERT ON native_photo_original_bindings BEGIN SELECT 1; END'); }
		const before = hash(await readFile(path)); assert.throws(() => inspect(db)); assert.throws(() => initialize(db));
		assert.equal(db.isTransaction, false); assert.equal(hash(await readFile(path)), before);
	});
});

void test('Lightscaper LSCP3 genuine denied COMMIT rolls migration back to exact LSCP2', options, async t => {
	await fixture(t, db => {
		historicalV2(db); seedHistoricalV2(db);
		db.setAuthorizer((action, operation) => action === constants.SQLITE_TRANSACTION && operation === 'COMMIT' ? constants.SQLITE_DENY : constants.SQLITE_OK);
		try { assert.throws(() => initialize(db)); } finally { db.setAuthorizer(null); }
		assert.equal(db.isTransaction, false); assert.equal(inspect(db), 'media-v2');
		assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 2); assert.equal(objects(db).length, 6);
	});
});

void test('Lightscaper LSCP3 preserves denied migration and actual rollback failure separately', options, async t => {
	await fixture(t, db => {
		historicalV2(db);
		db.setAuthorizer((action, operation) => action === constants.SQLITE_CREATE_INDEX || (action === constants.SQLITE_TRANSACTION && operation === 'ROLLBACK') ? constants.SQLITE_DENY : constants.SQLITE_OK);
		let failure: unknown;
		try { initialize(db); } catch (error) { failure = error; }
		assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2); assert.equal(db.isTransaction, true);
		db.setAuthorizer(null); db.exec('ROLLBACK'); assert.equal(inspect(db), 'media-v2');
	});
});

void test('Lightscaper LSCP3 head composite FK refuses a locator with another byte length', options, async t => {
	await fixture(t, db => {
		initialize(db); db.prepare('INSERT INTO native_photo_original_body_locators VALUES(?,?,?,?)').run(SHA, 'b'.repeat(64), 3, 'generation-v1');
		assert.throws(() => db.prepare('INSERT INTO native_photo_original_body_heads VALUES(?,?,?,?)').run(SHA, 'b'.repeat(64), 4, 0));
	});
});
