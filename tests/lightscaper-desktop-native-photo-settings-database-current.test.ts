/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativePhotoSettingsPathsCurrentV1 as paths,
	initializeLightscaperNativePhotoSettingsDatabaseCurrentV1 as initialize,
	inspectLightscaperNativePhotoSettingsDatabaseCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-settings-database-current-v1.ts';

const APPLICATION = 0x4c535354;
const objects = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const pragma = (db: DatabaseSync, name: string) => db.prepare(`PRAGMA ${name}`).get()?.[name];
async function fixture(run: (path: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native settings schema ü ')));
	await run(join(directory, 'settings.sqlite3')); await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native settings paths are fixed and create no unrelated Original resource or catalog stores', () => {
	const root = resolve(tmpdir(), 'Lightscaper settings path ü'), result = paths(root);
	assert.deepEqual(result, { libraryRoot: join(root, 'Lightscaper', 'project-library', 'v1'),
		databasePath: join(root, 'Lightscaper', 'project-library', 'v1', 'native-photo-settings.sqlite3') });
	assert.ok(Object.isFrozen(result));
	for (const value of ['', 'relative', `${root}/../other`, `${root}\0bad`]) assert.throws(() => paths(value));
});

test('Lightscaper native settings owns a distinct LSST identity and exactly one STRICT composite-key table', () => {
	const db = new DatabaseSync(':memory:');
	try {
		initialize(db); assert.equal(pragma(db, 'application_id'), APPLICATION); assert.equal(pragma(db, 'user_version'), 1);
		assert.equal(pragma(db, 'foreign_keys'), 1); assert.equal(inspect(db), 'owned');
		const owned = objects(db); assert.equal(owned.length, 1); assert.equal(owned[0]?.name, 'native_photo_settings');
		assert.equal(owned[0]?.type, 'table'); assert.match(String(owned[0]?.sql), /STRICT$/u);
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_settings)').all().map(row => [row.name, row.type, row.notnull, row.pk]),
			[['scope', 'TEXT', 1, 1], ['key', 'BLOB', 1, 2], ['payload', 'BLOB', 1, 0]]);
		const before = objects(db); initialize(db); assert.deepEqual(objects(db), before);
	} finally { db.close(); }
});

test('Lightscaper native settings SQL bounds scope and lossless key geometry without narrowing the opaque payload grammar', () => {
	const db = new DatabaseSync(':memory:');
	try {
		initialize(db); const put = db.prepare('INSERT INTO native_photo_settings(scope,key,payload) VALUES(?,?,?)');
		put.run('anchor', new Uint8Array(0), new Uint8Array(0));
		put.run('anchor', Uint8Array.of(0xd8, 0x00), Uint8Array.of(0, 255));
		put.run('anchor', Uint8Array.of(0xff, 0xfd), Uint8Array.of(7));
		put.run('selected:a', new Uint8Array(0), Uint8Array.of(1));
		put.run(`selected:${'a'.repeat(128)}`, new Uint8Array(0), Uint8Array.of(2));
		put.run('selected:a-z_0.9', Uint8Array.of(0, 0), Uint8Array.of(3));
		assert.throws(() => put.run('anchor', new Uint8Array(0), Uint8Array.of(1)), /UNIQUE|PRIMARY/iu);
		for (const scope of ['', 'selected:', 'selected:A', 'selected:.a', 'selected:_a', 'selected:-a', `selected:${'a'.repeat(129)}`,
			'selected:a/b', 'selected:aé', 'selected:a\0b', 'anchor\0b', 'Anchor']) assert.throws(() => put.run(scope, Uint8Array.of(0, 1), Uint8Array.of(1)));
		for (const key of [Uint8Array.of(1), 'text', null]) assert.throws(() => put.run('anchor', key, Uint8Array.of(1)));
		for (const payload of ['text', null]) assert.throws(() => put.run('anchor', Uint8Array.of(0, 1), payload));
		assert.throws(() => put.run(null, Uint8Array.of(0, 1), Uint8Array.of(1)));
		db.prepare('INSERT INTO native_photo_settings VALUES(?,?,zeroblob(?))').run('anchor', Uint8Array.of(0, 1), 16 * 1024 ** 2 + 1);
		assert.equal(db.prepare('SELECT length(payload) AS size FROM native_photo_settings WHERE scope=? AND key=?').get('anchor', Uint8Array.of(0, 1))?.size, 16 * 1024 ** 2 + 1);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_settings').get()?.count, 7);
		// SQL owns only bounded key geometry and physical value custody. The
		// independent versioned clone codec must authenticate actual payloads.
	} finally { db.close(); }
});

test('Lightscaper native settings persists exact UTF16 key bytes and opaque values across real file reopen without rewriting rows', async () => {
	await fixture(async path => {
		let db = new DatabaseSync(path);
		try {
			initialize(db); db.prepare('INSERT INTO native_photo_settings VALUES(?,?,?)').run('anchor', Uint8Array.of(0xd8, 0, 0, 0), Uint8Array.of(0, 1, 255));
			db.close(); const before = await readFile(path); db = new DatabaseSync(path); initialize(db);
			const row = db.prepare('SELECT * FROM native_photo_settings WHERE scope=? AND key=?').get('anchor', Uint8Array.of(0xd8, 0, 0, 0));
			assert.ok(row); assert.equal(row.scope, 'anchor'); assert.deepEqual(row.key, Uint8Array.of(0xd8, 0, 0, 0)); assert.deepEqual(row.payload, Uint8Array.of(0, 1, 255));
			db.close(); assert.deepEqual(await readFile(path), before);
		} finally { if (db.isOpen) db.close(); }
	});
});

test('Lightscaper native settings fixed inspector authenticates actual read-only SQLite without repair or initialization', async () => {
	const empty = new DatabaseSync(':memory:');
	try { assert.equal(inspect(empty), 'empty'); assert.equal(pragma(empty, 'application_id'), 0); assert.equal(objects(empty).length, 0); }
	finally { empty.close(); }
	await fixture(async path => {
		const owner = new DatabaseSync(path); try { initialize(owner); } finally { owner.close(); }
		const before = await readFile(path), read = new DatabaseSync(path, { readOnly: true });
		try { read.exec('BEGIN'); assert.equal(inspect(read), 'owned'); read.exec('COMMIT'); assert.equal(read.isTransaction, false); }
		finally { read.close(); }
		assert.deepEqual(await readFile(path), before);
	});
});

for (const mode of ['foreign-table', 'foreign-app', 'future-version', 'extra-table', 'extra-trigger', 'weakened-table'] as const) {
	test(`Lightscaper native settings refuses ${mode} without altering actual foreign database bytes`, async () => {
		await fixture(async path => {
			let db = new DatabaseSync(path);
			try {
				if (mode === 'foreign-table') db.exec('CREATE TABLE foreign_bytes(value BLOB); INSERT INTO foreign_bytes VALUES(zeroblob(7))');
				else if (mode === 'foreign-app') db.exec('PRAGMA application_id=1280528963; PRAGMA user_version=1; CREATE TABLE foreign_bytes(value TEXT)');
				else if (mode === 'future-version') { initialize(db); db.exec('PRAGMA user_version=2'); }
				else if (mode === 'weakened-table') db.exec(`PRAGMA application_id=${APPLICATION}; PRAGMA user_version=1; CREATE TABLE native_photo_settings(scope TEXT,key BLOB,payload BLOB,PRIMARY KEY(scope,key))`);
				else { initialize(db); db.exec(mode === 'extra-table' ? 'CREATE TABLE sqliteXforeign(value TEXT)' : 'CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photo_settings BEGIN SELECT 1; END'); }
				db.close(); const before = await readFile(path); db = new DatabaseSync(path);
				assert.throws(() => initialize(db)); assert.equal(db.isTransaction, false); db.close(); assert.deepEqual(await readFile(path), before);
			} finally { if (db.isOpen) db.close(); }
		});
	});
}

test('Lightscaper native settings initialization never commandeers an existing transaction', () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec('BEGIN'); assert.throws(() => initialize(db), /transaction/iu); assert.equal(db.isTransaction, true);
		db.exec('ROLLBACK'); assert.equal(pragma(db, 'application_id'), 0); assert.equal(objects(db).length, 0);
	} finally { db.close(); }
});

test('Lightscaper native settings initialization rolls back actual denied CREATE and retains its independent rollback failure', () => {
	const db = new DatabaseSync(':memory:'), original = db.exec, cleanup = new Error('Injected after actual rollback');
	db.setAuthorizer(action => action === constants.SQLITE_CREATE_TABLE ? constants.SQLITE_DENY : constants.SQLITE_OK);
	db.exec = function (sql: string): void { original.call(db, sql); if (sql === 'ROLLBACK') throw cleanup; };
	try {
		let failure: unknown; try { initialize(db); } catch (error) { failure = error; }
		assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2); assert.equal(failure.errors[1], cleanup);
		assert.notEqual(failure.errors[0], cleanup); assert.equal(db.isTransaction, false);
		db.setAuthorizer(null); assert.equal(pragma(db, 'application_id'), 0); assert.equal(pragma(db, 'user_version'), 0); assert.equal(objects(db).length, 0);
	} finally { db.exec = original; db.setAuthorizer(null); db.close(); }
});
