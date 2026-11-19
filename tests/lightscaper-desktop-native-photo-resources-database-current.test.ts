/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 as paths,
	initializeLightscaperNativePhotoResourceDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-photo-resources-database-current-v1.ts';

const APPLICATION = 0x4c535243, sha = 'a'.repeat(64), lutKey = `lut-sha256:${sha}`, brushKey = `brush-mask-v1:1:1:${sha}`;
const reference = JSON.stringify({ storageKey: lutKey, sha256: sha, byteLength: 1, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
const objects = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const pragma = (db: DatabaseSync, name: string) => db.prepare(`PRAGMA ${name}`).get()?.[name];
async function fixture(run: (path: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native resource schema ü ')));
	await run(join(directory, 'resource.sqlite3'));
	await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native resource paths are fixed and contain no Original body or staging directories', () => {
	const root = resolve(tmpdir(), 'Lightscaper resource path ü'), result = paths(root);
	assert.deepEqual(result, { libraryRoot: join(root, 'Lightscaper', 'project-library', 'v1'),
		databasePath: join(root, 'Lightscaper', 'project-library', 'v1', 'native-photo-resources.sqlite3') });
	assert.ok(Object.isFrozen(result));
	for (const value of ['', 'relative', `${root}/../other`, `${root}\0bad`]) assert.throws(() => paths(value));
});

test('Lightscaper native resource schema owns a distinct LSRC identity and exactly one STRICT table', () => {
	const db = new DatabaseSync(':memory:');
	try {
		initialize(db); assert.equal(pragma(db, 'application_id'), APPLICATION); assert.equal(pragma(db, 'user_version'), 1);
		assert.equal(pragma(db, 'foreign_keys'), 1);
		const owned = objects(db); assert.equal(owned.length, 1); assert.equal(owned[0]?.name, 'native_photo_resources');
		assert.equal(owned[0]?.type, 'table'); assert.match(String(owned[0]?.sql), /STRICT$/u);
		const columns = db.prepare('PRAGMA table_info(native_photo_resources)').all();
		assert.deepEqual(columns.map(row => [row.name, row.type, row.notnull, row.pk]),
			[['storage_key', 'TEXT', 1, 1], ['family', 'TEXT', 1, 0], ['reference', 'TEXT', 1, 0], ['body', 'BLOB', 1, 0]]);
		const before = objects(db); initialize(db); assert.deepEqual(objects(db), before);
	} finally { db.close(); }
});

test('Lightscaper native resource physical SQL constraints bound types, namespaces, canonical JSON and each body family', () => {
	const db = new DatabaseSync(':memory:');
	try {
		initialize(db); const put = db.prepare('INSERT INTO native_photo_resources(storage_key,family,reference,body) VALUES(?,?,?,?)');
		put.run(lutKey, 'lut', reference, Uint8Array.of(1));
		put.run(brushKey, 'brush', '{}', new Uint8Array(17));
		assert.throws(() => put.run(lutKey, 'lut', reference, Uint8Array.of(1)), /UNIQUE|PRIMARY/iu);
		const boundary = db.prepare('INSERT INTO native_photo_resources VALUES(?,?,?,zeroblob(?))');
		boundary.run(`lut-sha256:${'c'.repeat(64)}`, 'lut', JSON.stringify({ x: 'x'.repeat(2040) }), 16 * 1024 ** 2);
		boundary.run(`brush-mask-v1:1024:1024:${'c'.repeat(64)}`, 'brush', '{}', 1_048_592);
		db.prepare('DELETE FROM native_photo_resources WHERE storage_key IN (?,?)').run(`lut-sha256:${'c'.repeat(64)}`, `brush-mask-v1:1024:1024:${'c'.repeat(64)}`);

		const invalid: readonly (readonly [string, string, string, Uint8Array | string | null])[] = [
			['unowned', 'lut', '{}', Uint8Array.of(1)], [`lut-sha256:${'é'.repeat(64)}`, 'lut', '{}', Uint8Array.of(1)],
			[`lut-sha256:${'b'.repeat(120)}`, 'lut', '{}', Uint8Array.of(1)], [`lut-sha256:${'b'.repeat(64)}`, 'audio', '{}', Uint8Array.of(1)],
			[`lut-sha256:${'b'.repeat(64)}`, 'brush', '{}', Uint8Array.of(1)], [`brush-mask-v1:1:1:${'b'.repeat(64)}`, 'lut', '{}', Uint8Array.of(1)],
			[`lut-sha256:${'b'.repeat(64)}`, 'lut', '{broken', Uint8Array.of(1)], [`lut-sha256:${'b'.repeat(64)}`, 'lut', '{ "x":1 }', Uint8Array.of(1)],
			[`lut-sha256:${'b'.repeat(64)}`, 'lut', JSON.stringify({ x: 'é'.repeat(1021) }), Uint8Array.of(1)],
			[`lut-sha256:${'b'.repeat(64)}`, 'lut', '{}', new Uint8Array(16 * 1024 ** 2 + 1)],
			[`brush-mask-v1:1:1:${'b'.repeat(64)}`, 'brush', '{}', new Uint8Array(1_048_593)],
			[`lut-sha256:${'b'.repeat(64)}`, 'lut', '{}', new Uint8Array(0)], [`lut-sha256:${'b'.repeat(64)}`, 'lut', '{}', 'text'],
			[`lut-sha256:${'b'.repeat(64)}`, 'lut', '{}', null]
		];
		for (const row of invalid) assert.throws(() => put.run(...row));
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_resources').get()?.count, 2);
		// This table proves bounded physical custody only. JavaScript's actual
		// resource owner must still authenticate the exact reference and body.
	} finally { db.close(); }
});

test('Lightscaper native resource schema persists opaque bounded body bytes and reopens without rewriting its owned rows', async () => {
	await fixture(async path => {
		let db = new DatabaseSync(path);
		try {
			initialize(db); db.prepare('INSERT INTO native_photo_resources VALUES(?,?,?,?)').run(lutKey, 'lut', reference, Uint8Array.of(0, 1, 255));
			db.close(); const before = await readFile(path); db = new DatabaseSync(path); initialize(db);
			const row = db.prepare('SELECT * FROM native_photo_resources WHERE storage_key=?').get(lutKey);
			assert.ok(row); assert.equal(row.reference, reference); assert.deepEqual(row.body, Uint8Array.of(0, 1, 255));
			db.close(); assert.deepEqual(await readFile(path), before);
		} finally { if (db.isOpen) db.close(); }
	});
});

for (const mode of ['foreign-table', 'foreign-app', 'future-version', 'extra-table', 'extra-trigger', 'weakened-table'] as const) {
	test(`Lightscaper native resource schema refuses ${mode} without altering actual foreign database bytes`, async () => {
		await fixture(async path => {
			let db = new DatabaseSync(path);
			try {
				if (mode === 'foreign-table') db.exec('CREATE TABLE foreign_bytes(value BLOB); INSERT INTO foreign_bytes VALUES(zeroblob(7))');
				else if (mode === 'foreign-app') db.exec('PRAGMA application_id=1280525136; PRAGMA user_version=1; CREATE TABLE foreign_bytes(value TEXT)');
				else if (mode === 'future-version') { initialize(db); db.exec('PRAGMA user_version=2'); }
				else if (mode === 'weakened-table') db.exec(`PRAGMA application_id=${APPLICATION}; PRAGMA user_version=1; CREATE TABLE native_photo_resources(storage_key TEXT PRIMARY KEY, family TEXT, reference TEXT, body BLOB)`);
				else { initialize(db); db.exec(mode === 'extra-table' ? 'CREATE TABLE sqliteXforeign(value TEXT)' : 'CREATE TRIGGER foreign_trigger AFTER INSERT ON native_photo_resources BEGIN SELECT 1; END'); }
				db.close(); const before = await readFile(path); db = new DatabaseSync(path);
				assert.throws(() => initialize(db)); assert.equal(db.isTransaction, false); db.close(); assert.deepEqual(await readFile(path), before);
			} finally { if (db.isOpen) db.close(); }
		});
	});
}

test('Lightscaper native resource initialization never commandeers an existing transaction', () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec('BEGIN'); assert.throws(() => initialize(db), /transaction/iu); assert.equal(db.isTransaction, true);
		db.exec('ROLLBACK'); assert.equal(pragma(db, 'application_id'), 0); assert.equal(objects(db).length, 0);
	} finally { db.close(); }
});

test('Lightscaper native resource initialization rolls back an actual denied CREATE and preserves its rollback failure independently', () => {
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
