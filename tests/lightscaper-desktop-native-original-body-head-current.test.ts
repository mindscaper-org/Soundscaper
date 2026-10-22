/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativePhotoMediaDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-photo-media-schema-current-v1.ts';
import { readLightscaperNativeOriginalBodyHeadCurrentV1 as readHead, reserveLightscaperNativeOriginalBodyLocatorCurrentV1 as reserve,
	switchLightscaperNativeOriginalBodyHeadCurrentV1 as switchHead } from '../desktop/lightscaper-native-original-body-head-current-v1.ts';
import { originalHeadFixtureCurrentV1 as fixture, immediateOriginalHeadCurrentV1 as immediate, ORIGINAL_HEAD_TEST_OPTIONS_CURRENT_V1 as options,
	ORIGINAL_HEAD_BINDING_CURRENT_V1 as binding, ORIGINAL_HEAD_ID_CURRENT_V1 as ID, ORIGINAL_HEAD_SHA_CURRENT_V1 as SHA } from './helpers/lightscaper-native-original-head-fixture-current.ts';

function seed(db: DatabaseSync): void { initialize(db); db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run(binding.storageKey, SHA, 3); }
function reserved(db: DatabaseSync, id = ID): void { immediate(db, () => { reserve(db, binding, id); }); }

void test('Lightscaper native head explicitly resolves absent head as legacy and preserves immutable locator reservations', options, async t => {
	await fixture(t, db => {
		seed(db); const before = readHead(db, binding);
		assert.deepEqual(before, { contentSha256: SHA, locatorId: 'legacy', byteLength: 3, layout: 'legacy-sha-v1', revision: null });
		reserved(db); assert.deepEqual(readHead(db, binding), before);
		const head = immediate(db, () => switchHead(db, binding, before, ID));
		assert.deepEqual(head, { contentSha256: SHA, locatorId: ID, byteLength: 3, layout: 'generation-v1', revision: 0 });
		assert.deepEqual(readHead(db, binding), head);
		assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_original_body_locators').get()?.n, 2);
	});
});

void test('Lightscaper native head is shared across distinct storage-key aliases but collision length refuses', options, async t => {
	await fixture(t, db => {
		seed(db); const alias = { ...binding, storageKey: 'alias' }; db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('alias', SHA, 3);
		reserved(db); immediate(db, () => switchHead(db, binding, readHead(db, binding), ID)); assert.deepEqual(readHead(db, alias), readHead(db, binding));
		db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('conflicting', SHA, 4);
		assert.throws(() => readHead(db, binding)); assert.throws(() => immediate(db, () => reserve(db, binding, 'c'.repeat(64))));
	});
});

void test('Lightscaper native head CAS rejects an actual second-connection winner and preserves it', options, async t => {
	await fixture(t, (db, path) => {
		seed(db); reserved(db); const captured = readHead(db, binding), second = new DatabaseSync(path);
		try { initialize(second); immediate(second, () => switchHead(second, binding, captured, ID));
			reserved(db, 'c'.repeat(64)); assert.throws(() => immediate(db, () => switchHead(db, binding, captured, 'c'.repeat(64))));
			assert.equal(readHead(db, binding).locatorId, ID);
		} finally { second.close(); }
	});
});

void test('Lightscaper native head writes require caller transaction and a reserved generation candidate', options, async t => {
	await fixture(t, db => {
		seed(db); const before = readHead(db, binding);
		assert.throws(() => reserve(db, binding, ID)); assert.throws(() => switchHead(db, binding, before, ID));
		assert.throws(() => immediate(db, () => switchHead(db, binding, before, ID)));
		for (const id of ['legacy', 'B'.repeat(64), 'b'.repeat(63), '../escape']) assert.throws(() => immediate(db, () => reserve(db, binding, id)));
	});
});

void test('Lightscaper native locator reservation has fixed generation debt and refuses duplicate identities', options, async t => {
	await fixture(t, db => {
		seed(db); for (let n = 0; n < 9; n++) { t.signal.throwIfAborted(); reserved(db, n.toString(16).padStart(64, '0')); }
		assert.throws(() => immediate(db, () => reserve(db, binding, 'f'.repeat(64))));
		assert.throws(() => immediate(db, () => reserve(db, binding, '0'.repeat(64))));
		assert.equal(db.prepare("SELECT count(*) AS n FROM native_photo_original_body_locators WHERE locator_id<>'legacy'").get()?.n, 9);
		assert.equal(readHead(db, binding).revision, null);
	});
});

for (const mode of ['ignored-locator', 'rewritten-locator', 'ignored-head', 'removed-head', 'rewritten-head'] as const) void test(`Lightscaper native head refuses actual ${mode} trigger effects`, options, async t => {
	await fixture(t, db => {
		seed(db); const before = readHead(db, binding);
		if (mode === 'ignored-locator') db.exec("CREATE TRIGGER fault BEFORE INSERT ON native_photo_original_body_locators WHEN NEW.locator_id<>'legacy' BEGIN SELECT RAISE(IGNORE); END");
		else if (mode === 'rewritten-locator') db.exec("CREATE TRIGGER fault AFTER INSERT ON native_photo_original_body_locators WHEN NEW.locator_id<>'legacy' BEGIN UPDATE native_photo_original_body_locators SET byte_length=byte_length+1 WHERE locator_id=NEW.locator_id; END");
		else { reserved(db); db.exec(mode === 'ignored-head' ? 'CREATE TRIGGER fault BEFORE INSERT ON native_photo_original_body_heads BEGIN SELECT RAISE(IGNORE); END'
			: mode === 'removed-head' ? 'CREATE TRIGGER fault AFTER INSERT ON native_photo_original_body_heads BEGIN DELETE FROM native_photo_original_body_heads WHERE content_sha256=NEW.content_sha256; END'
			: 'CREATE TRIGGER fault AFTER INSERT ON native_photo_original_body_heads BEGIN UPDATE native_photo_original_body_heads SET revision=revision+1 WHERE content_sha256=NEW.content_sha256; END'); }
		try { assert.throws(() => immediate(db, () => { if (mode.endsWith('locator')) reserve(db, binding, ID); else switchHead(db, binding, before, ID); })); }
		finally { db.exec('DROP TRIGGER fault'); }
		assert.deepEqual(readHead(db, binding), before);
	});
});

void test('Lightscaper native head real deferred-FK COMMIT refusal rolls back the head while keeping reserved locator debt', options, async t => {
	await fixture(t, db => {
		seed(db); reserved(db); const before = readHead(db, binding);
		db.exec('CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED)');
		db.exec('CREATE TRIGGER fault AFTER INSERT ON native_photo_original_body_heads BEGIN INSERT INTO fault_child VALUES(1); END');
		try { assert.throws(() => immediate(db, () => switchHead(db, binding, before, ID)), /FOREIGN KEY/u); }
		finally { db.exec('DROP TRIGGER fault; DROP TABLE fault_child; DROP TABLE fault_parent'); }
		assert.deepEqual(readHead(db, binding), before); assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_original_body_locators').get()?.n, 2);
	});
});

void test('Lightscaper native head true COMMIT remains observable after an opaque lost-ACK observer', options, async t => {
	await fixture(t, db => {
		seed(db); reserved(db); const before = readHead(db, binding), exec = db.exec, reason = Symbol('after actual head COMMIT');
		db.exec = function (sql: string): void { exec.call(this, sql); if (sql === 'COMMIT') throw reason; };
		try { assert.throws(() => immediate(db, () => switchHead(db, binding, before, ID)), error => error === reason); }
		finally { db.exec = exec; }
		assert.equal(db.isTransaction, false); assert.equal(readHead(db, binding).locatorId, ID);
	});
});

void test('Lightscaper native head refuses missing locator without legacy fallback and bounds corrupt persisted text', options, async t => {
	await fixture(t, db => {
		seed(db); reserved(db); immediate(db, () => switchHead(db, binding, readHead(db, binding), ID));
		db.exec('PRAGMA foreign_keys=OFF'); db.prepare('DELETE FROM native_photo_original_body_locators WHERE locator_id=?').run(ID);
		assert.throws(() => readHead(db, binding));
		db.exec('PRAGMA ignore_check_constraints=ON'); db.prepare('UPDATE native_photo_original_body_heads SET locator_id=?').run('b'.repeat(8192));
		let largest = 0; const prepare = db.prepare;
		db.prepare = function (sql: string) { const statement = prepare.call(this, sql), get = statement.get;
			Object.defineProperty(statement, 'get', { value: function (this: typeof statement, ...args: unknown[]) {
				const row = Reflect.apply(get, this, args) as ReturnType<typeof get>;
				if (row) for (const value of Object.values(row)) if (typeof value === 'string') largest = Math.max(largest, value.length); return row;
			} }); return statement; };
		try { assert.throws(() => readHead(db, binding)); } finally { db.prepare = prepare; }
		assert.ok(largest <= 128, `bounded scalar length ${largest}`);
	});
});

void test('Lightscaper native head refuses revision overflow before mutating the selected locator', options, async t => {
	await fixture(t, db => {
		seed(db); reserved(db); immediate(db, () => switchHead(db, binding, readHead(db, binding), ID)); reserved(db, 'c'.repeat(64));
		db.prepare('UPDATE native_photo_original_body_heads SET revision=?').run(Number.MAX_SAFE_INTEGER);
		const current = readHead(db, binding); assert.throws(() => immediate(db, () => switchHead(db, binding, current, 'c'.repeat(64))));
		assert.deepEqual(readHead(db, binding), current);
	});
});

void test('Lightscaper native head does not read any asset metadata or retained root document', options, async t => {
	await fixture(t, db => {
		seed(db); db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ &&
			((table === 'native_photo_media_assets' && column === 'metadata') || (table === 'native_photo_media_roots' && column === 'root')) ? constants.SQLITE_DENY : constants.SQLITE_OK);
		try { const before = readHead(db, binding); reserved(db); immediate(db, () => switchHead(db, binding, before, ID)); assert.equal(readHead(db, binding).locatorId, ID); }
		finally { db.setAuthorizer(null); }
	});
});
