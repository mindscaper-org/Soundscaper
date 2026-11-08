/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants, DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativePhotoMediaDatabaseCurrentV1 as initialize,
	inspectLightscaperNativePhotoMediaDatabaseCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-media-schema-current-v1.ts';
import { linkedSchemaFixtureCurrentV1 as fixture, LINKED_SCHEMA_OPTIONS_CURRENT_V1 as options,
	seedHistoricalLinkedSchemaCurrentV1 as seed, linkedSchemaRowsCurrentV1 as rows, linkedSchemaObjectsCurrentV1 as objects,
	linkedSchemaHashCurrentV1 as hash } from './helpers/lightscaper-native-linked-media-schema-fixture-current.ts';

const scalar = (db: DatabaseSync, sql: string, name: string) => db.prepare(sql).get()?.[name];
const version = (db: DatabaseSync) => scalar(db, 'PRAGMA user_version', 'user_version');
const retained = new Set(['native_photo_original_bindings', 'native_photo_original_body_heads', 'native_photo_original_body_locators', 'native_photo_media_roots']);

void test('Lightscaper LSCP4 refuses a caller transaction without committing, joining or rolling it back', options, async context => {
	await fixture(context, db => {
		db.exec('BEGIN');
		try { assert.throws(() => initialize(db), /transaction/iu); assert.equal(db.isTransaction, true); }
		finally { if (db.isTransaction) db.exec('ROLLBACK'); }
		assert.equal(inspect(db), 'empty');
	});
});

void test('Lightscaper LSCP4 owns the typed parent and linked leaf without changing managed physical tables', options, async context => {
	await fixture(context, db => {
		initialize(db); assert.equal(version(db), 4); assert.equal(inspect(db), 'owned');
		assert.equal(scalar(db, 'PRAGMA foreign_keys', 'foreign_keys'), 1);
		assert.deepEqual(objects(db).map(row => [row.type, row.name]), [
			['index', 'native_photo_media_assets_digest'], ['index', 'native_photo_media_roots_asset'], ['index', 'native_photo_media_roots_scope'],
			['index', 'native_photo_original_bindings_digest'], ['index', 'native_photo_original_bindings_identity'],
			['table', 'native_photo_linked_original_bindings'], ['table', 'native_photo_media_assets'], ['table', 'native_photo_media_identities'],
			['table', 'native_photo_media_roots'], ['table', 'native_photo_original_bindings'], ['table', 'native_photo_original_body_heads'], ['table', 'native_photo_original_body_locators'],
		]);
		for (const name of ['native_photo_linked_original_bindings', 'native_photo_media_identities']) {
			assert.equal(db.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(name)?.strict, 1);
		}
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_media_identities)').all().map(row => row.name), ['source_id', 'kind', 'sha256', 'size', 'managed_key', 'linked_key']);
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_linked_original_bindings)').all().map(row => row.name), ['storage_key', 'content_sha256', 'byte_length', 'grant_id', 'locator_id', 'revision', 'locator']);
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_media_assets)').all().map(row => row.name), ['source_id', 'sha256', 'size', 'media_content_token', 'metadata', 'root_count', 'committed_at', 'pending_until']);
		assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
	});
});

for (const priorVersion of [1, 2, 3] as const) void test(`Lightscaper exact LSCP${priorVersion} migrates directly to4 with all historical row bytes and insertion states`, options, async context => {
	await fixture(context, async (db, path, directory) => {
		seed(db, priorVersion); const before = rows(db, priorVersion), priorDdl = objects(db).filter(row => typeof row.name === 'string' && retained.has(row.name));
		const body = Uint8Array.of(1, 255, 0, 3), bodyPath = join(directory, 'independent-Original.body'); await writeFile(bodyPath, body);
		initialize(db); assert.equal(version(db), 4); assert.deepEqual(rows(db, 4), before);
		for (const table of priorDdl) assert.ok(objects(db).some(value => value.name === table.name && value.sql === table.sql));
		const identities = db.prepare('SELECT source_id,kind,managed_key,linked_key FROM native_photo_media_identities ORDER BY source_id').all();
		assert.deepEqual(identities.map(row => [row.source_id, row.kind, row.managed_key, row.linked_key]), priorVersion === 1 ? [] : [
			['pending', 'managed', 'pending', null], ['published', 'managed', 'published', null] ]);
		assert.equal(scalar(db, "SELECT count(*) AS n FROM native_photo_media_identities WHERE source_id='orphan'", 'n'), 0);
		assert.equal(scalar(db, 'SELECT count(*) AS n FROM native_photo_linked_original_bindings', 'n'), 0);
		assert.equal(hash(await readFile(bodyPath)), hash(body));
		const expected = rows(db, 4), schema = objects(db); initialize(db); assert.deepEqual(rows(db, 4), expected); assert.deepEqual(objects(db), schema);
		const reopened = new DatabaseSync(path); try { initialize(reopened); assert.deepEqual(rows(reopened, 4), expected); } finally { reopened.close(); }
	});
});

for (const priorVersion of [1, 2, 3] as const) void test(`Lightscaper readonly LSCP${priorVersion} preflight never migrates or rewrites the real primary`, options, async context => {
	await fixture(context, async (db, path) => {
		seed(db, priorVersion); const before = hash(await readFile(path)), reader = new DatabaseSync(path, { readOnly: true });
		try { assert.equal(inspect(reader), priorVersion === 1 ? 'original-v1' : priorVersion === 2 ? 'media-v2' : 'media-v3'); }
		finally { reader.close(); }
		assert.equal(version(db), priorVersion); assert.equal(hash(await readFile(path)), before);
	});
});

void test('Lightscaper LSCP4 copies a genuine large opaque metadata BLOB only inside SQLite, with no JS payload materialization', options, async context => {
	await fixture(context, db => {
		seed(db, 3, true); const before = rows(db, 3), prepare = db.prepare; let oversizedDeliveries = 0, blobDeliveries = 0;
		const observe = (row: Record<string, SQLOutputValue> | undefined) => {
			for (const value of Object.values(row ?? {})) {
				if (value instanceof Uint8Array) blobDeliveries++;
				if ((value instanceof Uint8Array && value.byteLength > 65536) || (typeof value === 'string' && value.length > 65536)) oversizedDeliveries++;
			}
		};
		db.prepare = function (...args: Parameters<typeof prepare>) {
			const statement = Reflect.apply(prepare, db, args) as ReturnType<typeof prepare>, get = statement.get, all = statement.all, iterate = statement.iterate;
			statement.get = function (...values: unknown[]) { const value = Reflect.apply(get, statement, values) as ReturnType<typeof get>; observe(value); return value; };
			statement.all = function (...values: unknown[]) { const value = Reflect.apply(all, statement, values) as ReturnType<typeof all>; value.forEach(observe); return value; };
			statement.iterate = function (...values: unknown[]) {
				const iterator = Reflect.apply(iterate, statement, values) as ReturnType<typeof iterate>, next = iterator.next;
				iterator.next = function () { const value = Reflect.apply(next, iterator, []) as ReturnType<typeof next>; if (!value.done) observe(value.value); return value; };
				return iterator;
			};
			return statement;
		};
		try { initialize(db); } finally { db.prepare = prepare; }
		assert.equal(version(db), 4); assert.equal(blobDeliveries, 0); assert.equal(oversizedDeliveries, 0); assert.deepEqual(rows(db, 4), before);
	});
});

void test('Lightscaper LSCP4 keeps actual FK enforcement and one BEGIN IMMEDIATE through all migration DDL and copies', options, async context => {
	await fixture(context, db => {
		seed(db, 3); const execute = db.exec, events: string[] = []; let foreignKeysOff = 0;
		db.exec = function (sql: string): void {
			execute.call(db, sql);
			if (/^(?:BEGIN|COMMIT|ROLLBACK)/iu.test(sql.trim())) events.push(sql.trim().toUpperCase());
			if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) foreignKeysOff++;
		};
		try { initialize(db); } finally { db.exec = execute; }
		assert.equal(version(db), 4); assert.equal(foreignKeysOff, 0); assert.deepEqual(events, ['BEGIN IMMEDIATE', 'COMMIT']);
	});
});

for (const fault of ['late-drop', 'commit'] as const) void test(`Lightscaper LSCP4 ${fault} refusal rolls back the entire real migration`, options, async context => {
	await fixture(context, db => {
		seed(db, 3); const before = rows(db, 3), schema = objects(db); let refused = 0;
		db.setAuthorizer((action, target) => {
			if ((fault === 'late-drop' && action === constants.SQLITE_DROP_TABLE && target === 'native_photo_media_assets')
				|| (fault === 'commit' && action === constants.SQLITE_TRANSACTION && target === 'COMMIT')) { refused++; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		try { assert.throws(() => initialize(db)); } finally { db.setAuthorizer(null); }
		assert.equal(refused, 1); assert.equal(db.isTransaction, false); assert.equal(version(db), 3);
		assert.deepEqual(objects(db), schema); assert.deepEqual(rows(db, 3), before);
	});
});

void test('Lightscaper LSCP4 preserves primary migration refusal and genuine denied ROLLBACK separately', options, async context => {
	await fixture(context, db => {
		seed(db, 3); const before = rows(db, 3), schema = objects(db);
		db.setAuthorizer((action, target) => (action === constants.SQLITE_DROP_TABLE && target === 'native_photo_media_assets')
			|| (action === constants.SQLITE_TRANSACTION && target === 'ROLLBACK') ? constants.SQLITE_DENY : constants.SQLITE_OK);
		let failure: unknown;
		try { initialize(db); } catch (error) { failure = error; }
		try { assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2); assert.notEqual(failure.errors[0], failure.errors[1]); assert.equal(db.isTransaction, true); }
		finally { db.setAuthorizer(null); if (db.isTransaction) db.exec('ROLLBACK'); }
		assert.deepEqual(objects(db), schema); assert.deepEqual(rows(db, 3), before);
	});
});

for (const mutation of ['wrong-app', 'future', 'extra-table', 'extra-trigger', 'weakened'] as const) void test(`Lightscaper LSCP4 refuses ${mutation} historical schema before changing real primary bytes`, options, async context => {
	await fixture(context, async (db, path) => {
		seed(db, 3);
		if (mutation === 'wrong-app') db.exec('PRAGMA application_id=1');
		else if (mutation === 'future') db.exec('PRAGMA user_version=5');
		else if (mutation === 'extra-table') db.exec('CREATE TABLE foreign_bytes(value BLOB)');
		else if (mutation === 'extra-trigger') db.exec('CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photo_original_bindings BEGIN SELECT 1; END');
		else db.exec('DROP INDEX native_photo_original_bindings_digest');
		const before = hash(await readFile(path)); assert.throws(() => inspect(db)); assert.throws(() => initialize(db));
		assert.equal(db.isTransaction, false); assert.equal(hash(await readFile(path)), before);
	});
});

void test('Lightscaper LSCP4 refuses rather than blesses a legacy asset whose immutable SHA/size disagrees with its binding', options, async context => {
	await fixture(context, db => {
		seed(db, 3); db.prepare("UPDATE native_photo_media_assets SET sha256=? WHERE source_id='published'").run('f'.repeat(64));
		const before = rows(db, 3), schema = objects(db);
		assert.throws(() => initialize(db)); assert.equal(db.isTransaction, false); assert.equal(version(db), 3);
		assert.deepEqual(rows(db, 3), before); assert.deepEqual(objects(db), schema);
	});
});
