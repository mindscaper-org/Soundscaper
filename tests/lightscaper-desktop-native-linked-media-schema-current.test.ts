/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativePhotoMediaDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-photo-media-schema-current-v1.ts';
import { immediateOriginalHeadCurrentV1 as immediate } from './helpers/lightscaper-native-original-head-fixture-current.ts';
import { linkedSchemaFixtureCurrentV1 as fixture, LINKED_SCHEMA_OPTIONS_CURRENT_V1 as options,
	LINKED_SCHEMA_SHA_CURRENT_V1 as SHA, LINKED_SCHEMA_OTHER_SHA_CURRENT_V1 as OTHER,
	insertLinkedSchemaIdentityCurrentV1 as identity, insertLinkedSchemaLeafCurrentV1 as linked,
	insertLinkedSchemaAssetCurrentV1 as asset, linkedSchemaHashCurrentV1 as hash } from './helpers/lightscaper-native-linked-media-schema-fixture-current.ts';

/** Every positive in this spec is a SQL constraint/storage fixture, NOT
 * authenticated linked provenance, a native file/root grant, or a Photo. */
function mixed(db: DatabaseSync): void {
	initialize(db);
	db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('managed', SHA, 3);
	identity(db, 'managed', 'managed'); asset(db, 'managed', SHA, 3);
	linked(db, 'linked'); identity(db, 'linked', 'linked'); asset(db, 'linked', SHA, 3);
}
const count = (db: DatabaseSync, table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n;

void test('Lightscaper LSCP4 scalar linked chain can share content identity without minting a managed binding or body head', options, async context => {
	await fixture(context, db => {
		mixed(db);
		assert.deepEqual(db.prepare('SELECT source_id,kind FROM native_photo_media_identities ORDER BY source_id').all().map(row => [row.source_id, row.kind]), [['linked', 'linked'], ['managed', 'managed']]);
		assert.deepEqual(db.prepare('SELECT storage_key FROM native_photo_original_bindings').all().map(row => row.storage_key), ['managed']);
		assert.equal(count(db, 'native_photo_original_body_heads'), 0); assert.equal(count(db, 'native_photo_original_body_locators'), 0);
		assert.equal(count(db, 'native_photo_media_assets'), 2); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
	});
});

void test('Lightscaper LSCP4 composite parent/asset FKs refuse missing or mismatched immutable content tuples', options, async context => {
	await fixture(context, db => {
		initialize(db);
		assert.throws(() => asset(db, 'missing', SHA, 3), /FOREIGN KEY/iu);
		db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('managed', SHA, 3);
		assert.throws(() => identity(db, 'managed', 'managed', OTHER, 3), /FOREIGN KEY/iu);
		assert.throws(() => identity(db, 'managed', 'managed', SHA, 4), /FOREIGN KEY/iu);
		assert.throws(() => identity(db, 'managed', 'linked'), /FOREIGN KEY/iu);
		identity(db, 'managed', 'managed');
		assert.throws(() => asset(db, 'managed', OTHER, 3), /FOREIGN KEY/iu); assert.throws(() => asset(db, 'managed', SHA, 4), /FOREIGN KEY/iu);
		linked(db, 'linked'); assert.throws(() => identity(db, 'linked', 'linked', OTHER, 3), /FOREIGN KEY/iu);
		assert.throws(() => identity(db, 'linked', 'linked', SHA, 4), /FOREIGN KEY/iu);
	});
});

void test('Lightscaper LSCP4 kind branches are exact, nonnullable and exclusive even when both scalar leaves exist', options, async context => {
	await fixture(context, db => {
		initialize(db); linked(db, 'same'); db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('same', SHA, 3);
		const put = db.prepare('INSERT INTO native_photo_media_identities VALUES(?,?,?,?,?,?)');
		for (const [kind, managed, link] of [ ['managed', null, null], ['linked', null, null], ['managed', 'same', 'same'],
			['linked', 'same', 'same'], ['managed', null, 'same'], ['linked', 'same', null], ['invented', 'same', null] ] as const) {
			assert.throws(() => put.run('same', kind, SHA, 3, managed, link));
		}
		identity(db, 'same', 'managed'); assert.throws(() => identity(db, 'same', 'linked'), /UNIQUE/iu);
	});
});

void test('Lightscaper LSCP4 linked scalar storage enforces bounded native descriptors and preserves lossless bytes', options, async context => {
	await fixture(context, db => {
		initialize(db);
		const descriptor = Uint8Array.of(83, 67, 80, 76, 1, 0, 255, 128, 0, 216, 0, 220, 0);
		linked(db, 'linked', descriptor);
		const stored = db.prepare("SELECT locator FROM native_photo_linked_original_bindings WHERE storage_key='linked'").get()?.locator;
		assert.ok(stored instanceof Uint8Array); assert.equal(stored.byteLength, descriptor.byteLength); assert.equal(hash(stored), hash(descriptor));
		const insert = db.prepare('INSERT INTO native_photo_linked_original_bindings VALUES(?,?,?,?,?,?,?)');
		for (const [key, sha, size, grant, locator, revision, bytes] of [
			['bad', SHA, 3, 'A'.repeat(64), '2'.repeat(64), 0, descriptor], ['bad', SHA, 3, '1'.repeat(64), 'short', 0, descriptor],
			['bad', SHA, 3, '1'.repeat(64), '2'.repeat(64), -1, descriptor], ['bad', SHA, 3, '1'.repeat(64), '2'.repeat(64), 1.5, descriptor],
			['bad', SHA, 0, '1'.repeat(64), '2'.repeat(64), 0, descriptor], ['bad', SHA, 205520897, '1'.repeat(64), '2'.repeat(64), 0, descriptor],
			['bad', 'A'.repeat(64), 3, '1'.repeat(64), '2'.repeat(64), 0, descriptor], ['bad', SHA, 3, '1'.repeat(64), '2'.repeat(64), 0, new Uint8Array(0)],
			['bad', SHA, 3, '1'.repeat(64), '2'.repeat(64), 0, new Uint8Array(65537)], ['línked', SHA, 3, '1'.repeat(64), '2'.repeat(64), 0, descriptor],
			['a\0b', SHA, 3, '1'.repeat(64), '2'.repeat(64), 0, descriptor],
		] as const) assert.throws(() => insert.run(key, sha, size, grant, locator, revision, bytes));
	});
});

void test('Lightscaper LSCP4 retains explicit noncascading root→asset→typed-parent→correct-leaf retirement', options, async context => {
	await fixture(context, db => {
		mixed(db);
		const root = db.prepare('INSERT INTO native_photo_media_roots VALUES(?,?,?,?)');
		root.run(Uint8Array.of(0, 1), Uint8Array.of(0, 1), 'managed', '{}'); root.run(Uint8Array.of(0, 2), Uint8Array.of(0, 1), 'linked', '{}');
		for (const key of ['managed', 'linked']) {
			assert.throws(() => db.prepare('DELETE FROM native_photo_media_assets WHERE source_id=?').run(key), /FOREIGN KEY/iu);
			assert.throws(() => db.prepare('DELETE FROM native_photo_media_identities WHERE source_id=?').run(key), /FOREIGN KEY/iu);
			const table = key === 'managed' ? 'native_photo_original_bindings' : 'native_photo_linked_original_bindings';
			assert.throws(() => db.prepare(`DELETE FROM ${table} WHERE storage_key=?`).run(key), /FOREIGN KEY/iu);
		}
		immediate(db, () => {
			db.exec('DELETE FROM native_photo_media_roots; DELETE FROM native_photo_media_assets; DELETE FROM native_photo_media_identities; DELETE FROM native_photo_linked_original_bindings; DELETE FROM native_photo_original_bindings');
		});
		assert.equal(count(db, 'native_photo_media_assets'), 0); assert.equal(count(db, 'native_photo_media_identities'), 0);
		assert.equal(count(db, 'native_photo_original_bindings'), 0); assert.equal(count(db, 'native_photo_linked_original_bindings'), 0);
	});
});

void test('Lightscaper LSCP4 mixed scalar custody commits both kinds in one actual transaction', options, async context => {
	await fixture(context, db => {
		mixed(db); immediate(db, () => {
			db.exec('UPDATE native_photo_media_assets SET root_count=1');
			const insert = db.prepare('INSERT INTO native_photo_media_roots VALUES(?,?,?,?)');
			insert.run(Uint8Array.of(0, 1), Uint8Array.of(0, 1), 'managed', '{}'); insert.run(Uint8Array.of(0, 2), Uint8Array.of(0, 1), 'linked', '{}');
		});
		assert.deepEqual(db.prepare('SELECT source_id,root_count FROM native_photo_media_assets ORDER BY source_id').all().map(row => [row.source_id, row.root_count]), [['linked', 1], ['managed', 1]]);
		assert.equal(count(db, 'native_photo_media_roots'), 2);
	});
});

void test('Lightscaper LSCP4 scalar locator revision is separate from immutable media identity and content token', options, async context => {
	await fixture(context, db => {
		mixed(db);
		const before = db.prepare('SELECT source_id,kind,sha256,size,managed_key,linked_key FROM native_photo_media_identities ORDER BY source_id').all();
		const assets = db.prepare('SELECT source_id,sha256,size,media_content_token,hex(metadata) AS metadata,root_count,committed_at,pending_until FROM native_photo_media_assets ORDER BY source_id').all();
		db.prepare("UPDATE native_photo_linked_original_bindings SET grant_id=?,locator_id=?,revision=revision+1,locator=? WHERE storage_key='linked' AND revision=0")
			.run('3'.repeat(64), '4'.repeat(64), Uint8Array.of(83, 67, 2, 255, 0));
		assert.equal(db.prepare("SELECT revision FROM native_photo_linked_original_bindings WHERE storage_key='linked'").get()?.revision, 1);
		assert.deepEqual(db.prepare('SELECT source_id,kind,sha256,size,managed_key,linked_key FROM native_photo_media_identities ORDER BY source_id').all(), before);
		assert.deepEqual(db.prepare('SELECT source_id,sha256,size,media_content_token,hex(metadata) AS metadata,root_count,committed_at,pending_until FROM native_photo_media_assets ORDER BY source_id').all(), assets);
		assert.equal(count(db, 'native_photo_original_body_heads'), 0);
	});
});

void test('Lightscaper LSCP4 later mixed-custody failure rolls back the earlier root and both counts', options, async context => {
	await fixture(context, db => {
		mixed(db); let firstInserted = false;
		assert.throws(() => immediate(db, () => {
			db.exec('UPDATE native_photo_media_assets SET root_count=1');
			const insert = db.prepare('INSERT INTO native_photo_media_roots VALUES(?,?,?,?)');
			insert.run(Uint8Array.of(0, 1), Uint8Array.of(0, 1), 'managed', '{}'); firstInserted = true;
			insert.run(Uint8Array.of(0, 2), Uint8Array.of(0, 1), 'missing-linked', '{}');
		}), /FOREIGN KEY/iu);
		assert.equal(firstInserted, true); assert.equal(count(db, 'native_photo_media_roots'), 0);
		assert.deepEqual(db.prepare('SELECT root_count FROM native_photo_media_assets').all().map(row => row.root_count), [0, 0]);
	});
});
