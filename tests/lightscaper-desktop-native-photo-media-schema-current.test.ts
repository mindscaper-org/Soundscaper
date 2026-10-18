/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativePhotoMediaDatabaseCurrentV1 as initialize,
	inspectLightscaperNativePhotoMediaDatabaseCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-media-schema-current-v1.ts';
import { initializeHistoricalLightscaperOriginalV1Current as historical,
	LIGHTSCAPER_ORIGINAL_V1_DDL_FIXTURE_CURRENT as V1 } from './helpers/lightscaper-native-original-v1-fixture-current.ts';

const APP = 0x4c534350, SHA = 'a'.repeat(64), TOKEN = 'media-content-0123456789abcdef';
const objects = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const pragma = (db: DatabaseSync, name: string) => db.prepare(`PRAGMA ${name}`).get()?.[name];
async function fixture(run: (path: string, directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper managed media schema ü ')));
	await run(join(directory, 'originals.sqlite3'), directory); await rm(directory, { recursive: true, force: false });
}
function physicalAsset(db: DatabaseSync, id = 'original-a'): void {
	db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run(id, SHA, 3);
	db.prepare('INSERT INTO native_photo_media_assets(source_id,sha256,size,media_content_token,metadata,root_count,committed_at,pending_until) VALUES(?,?,?,?,?,?,?,?)')
		.run(id, SHA, 3, TOKEN, Uint8Array.of(1), 0, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z');
}

test('Lightscaper managed media inspector leaves empty SQLite unchanged and initializer owns exact LSCP2 inventory', () => {
	const db = new DatabaseSync(':memory:');
	try {
		assert.equal(inspect(db), 'empty'); assert.equal(pragma(db, 'application_id'), 0); assert.equal(objects(db).length, 0);
		initialize(db); assert.equal(inspect(db), 'owned'); assert.equal(pragma(db, 'application_id'), APP);
		assert.equal(pragma(db, 'user_version'), 2); assert.equal(pragma(db, 'foreign_keys'), 1);
		assert.deepEqual(objects(db).map(row => [row.type, row.name]), [
			['index', 'native_photo_media_assets_digest'], ['index', 'native_photo_media_roots_asset'], ['index', 'native_photo_media_roots_scope'],
			['table', 'native_photo_media_assets'], ['table', 'native_photo_media_roots'], ['table', 'native_photo_original_bindings'],
		]);
		assert.equal(db.prepare("SELECT sql FROM sqlite_schema WHERE name='native_photo_original_bindings'").get()?.sql, V1);
		for (const name of ['native_photo_original_bindings', 'native_photo_media_assets', 'native_photo_media_roots']) {
			assert.equal(db.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(name)?.strict, 1);
		}
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_media_assets)').all().map(row => row.name),
			['source_id', 'sha256', 'size', 'media_content_token', 'metadata', 'root_count', 'committed_at', 'pending_until']);
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_media_roots)').all().map(row => row.name), ['root_key', 'scope_key', 'asset_id', 'root']);
		const before = objects(db); initialize(db); assert.deepEqual(objects(db), before);
	} finally { db.close(); }
});

test('Lightscaper LSCP1 real-file migration preserves immutable binding and body bytes without minting provenance or custody', async () => {
	await fixture(async (path, directory) => {
		const bodyPath = join(directory, 'immutable.body'), body = Uint8Array.of(1, 2, 3); await writeFile(bodyPath, body);
		let db = new DatabaseSync(path);
		try {
			historical(db); db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('old-original', SHA, 3);
			assert.equal(inspect(db), 'original-v1'); const old = db.prepare('SELECT * FROM native_photo_original_bindings').all(); db.close();
			const bytes = await readFile(path), read = new DatabaseSync(path, { readOnly: true });
			try { assert.equal(inspect(read), 'original-v1'); } finally { read.close(); }
			assert.deepEqual(await readFile(path), bytes);
			db = new DatabaseSync(path);
			// FK DDL may authorize parent-key metadata. Existing digest/length
			// aggregates are forbidden; migration must never inspect original rows.
			db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && table === 'native_photo_original_bindings'
				&& (column === 'content_sha256' || column === 'byte_length') ? constants.SQLITE_DENY : constants.SQLITE_OK);
			initialize(db); db.setAuthorizer(null);
			assert.equal(inspect(db), 'owned'); assert.deepEqual(db.prepare('SELECT * FROM native_photo_original_bindings').all(), old);
			assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_media_assets').get()?.n, 0);
			assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_media_roots').get()?.n, 0);
			assert.deepEqual(new Uint8Array(await readFile(bodyPath)), body); db.close();
			db = new DatabaseSync(path); initialize(db); assert.deepEqual(db.prepare('SELECT * FROM native_photo_original_bindings').all(), old);
		} finally { if (db.isOpen) { db.setAuthorizer(null); db.close(); } }
	});
});

test('Lightscaper managed media readonly ownership inspection never initializes or rewrites a real v2 file', async () => {
	await fixture(async path => {
		const owner = new DatabaseSync(path); try { initialize(owner); physicalAsset(owner); } finally { owner.close(); }
		const before = await readFile(path), reader = new DatabaseSync(path, { readOnly: true });
		try { reader.exec('BEGIN'); assert.equal(inspect(reader), 'owned'); reader.exec('COMMIT'); } finally { reader.close(); }
		assert.deepEqual(await readFile(path), before);
	});
});

for (const kind of ['foreign', 'wrong-app', 'future', 'extra-table', 'extra-trigger', 'weakened-v1'] as const) {
	test(`Lightscaper managed media refuses ${kind} before changing real database bytes`, async () => {
		await fixture(async path => {
			let db = new DatabaseSync(path);
			try {
				if (kind === 'foreign') db.exec('CREATE TABLE foreign_bytes(value BLOB); INSERT INTO foreign_bytes VALUES(zeroblob(17))');
				else if (kind === 'weakened-v1') db.exec(`PRAGMA application_id=${APP}; PRAGMA user_version=1; CREATE TABLE native_photo_original_bindings(storage_key TEXT PRIMARY KEY,content_sha256 TEXT,byte_length INTEGER)`);
				else { historical(db); if (kind === 'wrong-app') db.exec('PRAGMA application_id=1280528963');
					else if (kind === 'future') db.exec('PRAGMA user_version=3');
					else db.exec(kind === 'extra-table' ? 'CREATE TABLE sqliteXforeign(value TEXT)' : 'CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photo_original_bindings BEGIN SELECT 1; END'); }
				db.close(); const before = await readFile(path); db = new DatabaseSync(path);
				assert.throws(() => inspect(db)); assert.throws(() => initialize(db)); assert.equal(db.isTransaction, false);
				db.close(); assert.deepEqual(await readFile(path), before);
			} finally { if (db.isOpen) db.close(); }
		});
	});
}

test('Lightscaper managed media migration atomically rolls back denied index creation and preserves both rollback failures', () => {
	const db = new DatabaseSync(':memory:'), original = db.exec, cleanup = new Error('Observed actual rollback failure');
	try {
		historical(db); db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('old-original', SHA, 3);
		db.setAuthorizer(action => action === constants.SQLITE_CREATE_INDEX ? constants.SQLITE_DENY : constants.SQLITE_OK);
		db.exec = function (sql: string): void { original.call(db, sql); if (sql === 'ROLLBACK') throw cleanup; };
		let failure: unknown; try { initialize(db); } catch (error) { failure = error; }
		assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2); assert.equal(failure.errors[1], cleanup);
		assert.notEqual(failure.errors[0], cleanup); assert.equal(db.isTransaction, false); db.setAuthorizer(null);
		assert.equal(inspect(db), 'original-v1'); assert.equal(objects(db).length, 1);
		assert.equal(db.prepare('SELECT byte_length FROM native_photo_original_bindings').get()?.byte_length, 3);
	} finally { db.exec = original; db.setAuthorizer(null); db.close(); }
});

test('Lightscaper managed media initialization refuses an already-active transaction without joining or aborting it', () => {
	const db = new DatabaseSync(':memory:');
	try { db.exec('BEGIN'); assert.throws(() => initialize(db), /transaction/iu); assert.equal(db.isTransaction, true);
		db.exec('ROLLBACK'); assert.equal(inspect(db), 'empty'); } finally { db.close(); }
});

test('Lightscaper managed media STRICT physical schema enforces scalar geometry and explicit noncascading dependencies', () => {
	const db = new DatabaseSync(':memory:');
	try {
		initialize(db); physicalAsset(db);
		const put = db.prepare('UPDATE native_photo_media_assets SET sha256=?,size=?,media_content_token=?,root_count=?,committed_at=?,pending_until=? WHERE source_id=?');
		for (const [sha, size, token, count, committed, pending] of [
			['A'.repeat(64), 3, TOKEN, 0, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z'],
			[SHA, 0, TOKEN, 0, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z'],
			[SHA, 3, 'invented', 0, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z'],
			[SHA, 3, TOKEN, -1, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z'],
			[SHA, 3, TOKEN, 0, 'invalid', '2026-10-19T12:00:00.000Z'],
			[SHA, 3, TOKEN, 0, '2026-10-18T12:00:00.000Z', '2026-10-17T12:00:00.000Z'],
		] as const) assert.throws(() => put.run(sha, size, token, count, committed, pending, 'original-a'));
		const root = db.prepare('INSERT INTO native_photo_media_roots VALUES(?,?,?,?)');
		root.run(Uint8Array.of(0, 1), Uint8Array.of(0, 2), 'original-a', '{}');
		for (const [key, scope, json] of [[Uint8Array.of(1), Uint8Array.of(0, 2), '{}'],
			[Uint8Array.of(0, 3), Uint8Array.of(1), '{}'], [Uint8Array.of(0, 3), Uint8Array.of(0, 2), '{ "a": 1 }'],
			[Uint8Array.of(0, 3), Uint8Array.of(0, 2), JSON.stringify({ value: 'x'.repeat(2048) })]] as const) assert.throws(() => root.run(key, scope, 'original-a', json));
		assert.throws(() => db.prepare('DELETE FROM native_photo_original_bindings WHERE storage_key=?').run('original-a'), /FOREIGN KEY/iu);
		assert.throws(() => db.prepare('DELETE FROM native_photo_media_assets WHERE source_id=?').run('original-a'), /FOREIGN KEY/iu);
		// These intentionally scalar-only fixtures prove SQL constraints, never
		// native body authentication or custody provenance.
	} finally { db.close(); }
});
