/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { loadLightscaperNativeStackCurrentV1 as load, readLightscaperNativeStackStateCurrentV1 as state,
	saveLightscaperNativeStackCurrentV1 as save, dissolveLightscaperNativeStackCurrentV1 as dissolve } from '../desktop/lightscaper-native-stack-transactions-current-v1.ts';
import { captureLightscaperNativeStackContextCurrentV1 as capture, authenticateLightscaperNativeStackCurrentV1 as authenticate } from '../desktop/lightscaper-native-stack-auth-current-v1.ts';
import { admitLightscaperNativeCatalogPhotosCurrentV1 } from '../desktop/lightscaper-native-catalog-admission-current-v1.ts';
import { saveLightscaperNativePhotoCurrentV1 } from '../desktop/lightscaper-native-catalog-transactions-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const CATALOG = 'catalog', GROUPS = 'native_photo_stacks', STATES = 'native_photo_stack_states';
const FORWARD = 'native_photo_stack_forward_members', REVERSE = 'native_photo_stack_memberships';
const ids = (...indices: number[]) => indices.map(index => nativePhotoCurrentV1(index).id);
const stack = (indices = [0, 1], id = 'stack-a') => normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: CATALOG,
	id, revision: 0, photoIds: ids(...indices), coverPhotoId: ids(indices.at(-1)!)[0] });
const options = (expectedCatalogRevision = 1, expectedStateRevision = 0) => ({ expectedCatalogRevision, expectedStateRevision });
function seeded(count = 6, path = ':memory:'): DatabaseSync {
	const db = new DatabaseSync(path, { timeout: 20 }); initializeLightscaperNativeCatalogDatabaseCurrentV1(db);
	const root = normalizePhotoCatalogRootV1({ ...nativeCatalogRootCurrentV1(), revision: 1, photoCount: count,
		collections: nativeCatalogRootCurrentV1().collections.filter(value => value.kind === 'manual') });
	db.exec('BEGIN IMMEDIATE');
	try {
		db.prepare('INSERT INTO native_photo_catalogs(id,document,root_revision,photo_count,index_revision) VALUES(?,?,1,?,1)')
			.run(CATALOG, serializeLightscaperDocumentV1(root), count);
		for (let index = 0; index < count; index++) {
			const photo = nativePhotoCurrentV1(index);
			db.prepare('INSERT INTO native_photos(photo_key,catalog_id,photo_id,revision,document,summary) VALUES(?,?,?,0,?,?)')
				.run(photoStorageKey(CATALOG, photo.id), CATALOG, photo.id, serializePhotoDocumentCurrentV1(photo), JSON.stringify(photoSummary(photo)));
		}
		db.prepare('INSERT INTO native_photo_query_builds_v2(catalog_id,ready,after_key,indexed_count) VALUES(?,0,NULL,0)').run(CATALOG);
		db.prepare(`INSERT INTO ${STATES}(catalog_id,revision,stack_count) VALUES(?,0,0)`).run(CATALOG);
		db.exec('COMMIT'); return db;
	} catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); throw error; }
}
const sourceBytes = (db: DatabaseSync) => db.prepare('SELECT photo_key,revision,document,summary FROM native_photos ORDER BY photo_key').all();
const scalar = (db: DatabaseSync) => db.prepare('SELECT root_revision,index_revision,photo_count FROM native_photo_catalogs WHERE id=?').get(CATALOG);
const groups = (db: DatabaseSync) => [GROUPS, STATES, FORWARD, REVERSE].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
const count = (db: DatabaseSync, table: string) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
function snapshot<Result>(db: DatabaseSync, run: () => Result): Result {
	db.exec('BEGIN'); try { const result = run(); db.exec('COMMIT'); return result; }
	catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

test('Lightscaper native stack create reorder cover edit dissolve and recreate advance all grouping epochs without changing Photos', () => {
	const db = seeded();
	try {
		const before = sourceBytes(db), initial = stack([0, 1, 2]);
		assert.equal(load(db, CATALOG, initial.id), null); assert.equal(state(db, CATALOG).revision, 0);
		assert.deepEqual(save(db, initial, null, options()), initial); assert.deepEqual(load(db, CATALOG, initial.id), initial);
		assert.deepEqual({ ...scalar(db) }, { root_revision: 2, index_revision: 2, photo_count: 6 });
		const edited = save(db, { ...initial, photoIds: ids(2, 0, 3), coverPhotoId: ids(3)[0] }, 0, options(2, 1));
		assert.equal(edited.revision, 1); assert.deepEqual(edited.photoIds, ids(2, 0, 3));
		assert.deepEqual(db.prepare(`SELECT photo_id,member_position FROM ${REVERSE} ORDER BY member_position`).all().map(row => [row.photo_id, row.member_position]),
			ids(2, 0, 3).map((id, position) => [id, position]));
		assert.deepEqual(load(db, CATALOG, initial.id), edited); assert.equal(state(db, CATALOG).stackCount, 1);
		assert.equal(dissolve(db, CATALOG, initial.id, 1, options(3, 2)).revision, 3);
		assert.equal(load(db, CATALOG, initial.id), null); assert.equal(state(db, CATALOG).stackCount, 0);
		for (const table of [GROUPS, FORWARD, REVERSE]) assert.equal(count(db, table), 0);
		assert.equal(save(db, initial, null, options(4, 3)).revision, 0); assert.equal(state(db, CATALOG).revision, 4);
		assert.deepEqual({ ...scalar(db) }, { root_revision: 5, index_revision: 5, photo_count: 6 }); assert.deepEqual(sourceBytes(db), before);
	} finally { db.close(); }
});

test('Lightscaper native stack one-group ownership and declared member validation refuse atomically', () => {
	const db = seeded();
	try {
		const current = save(db, stack(), null, options()), before = groups(db), epochs = scalar(db);
		assert.throws(() => save(db, stack([1, 2], 'stack-b'), null, options(2, 1)), /another|belongs|group|stack/iu);
		assert.throws(() => save(db, { ...stack([2, 3]), photoIds: ids(2) }, null, options(2, 1)));
		assert.throws(() => save(db, { ...stack([2, 3]), photoIds: ids(2, 2) }, null, options(2, 1)));
		assert.throws(() => save(db, { ...stack([2, 3]), coverPhotoId: ids(5)[0] }, null, options(2, 1)));
		assert.throws(() => save(db, stack([4, 99], 'absent-source'), null, options(2, 1)), ReferenceError);
		assert.throws(() => save(db, current, null, options(2, 1)), { code: 'STACK_REVISION_CONFLICT' });
		assert.deepEqual(groups(db), before); assert.deepEqual(scalar(db), epochs);
	} finally { db.close(); }
});

test('Lightscaper native stack authenticates the maximum 1024 ordered members without loading Photo documents', () => {
	const db = seeded(1024);
	try {
		// Source existence is scalar authority. Grouping never reparses or edits
		// unrelated Photo/Develop bytes, including an independently damaged body.
		db.prepare("UPDATE native_photos SET document='{}' WHERE photo_id=?").run(ids(7)[0]);
		const before = sourceBytes(db), current = stack(Array.from({ length: 1024 }, (_, index) => index));
		save(db, current, null, options()); assert.deepEqual(load(db, CATALOG, current.id), current);
		assert.equal(count(db, FORWARD), 1024); assert.equal(count(db, REVERSE), 1024);
		assert.throws(() => save(db, { ...current, photoIds: ids(...Array.from({ length: 1025 }, (_, index) => index)) }, 0, options(2, 1)));
		assert.deepEqual(sourceBytes(db), before);
	} finally { db.close(); }
});

for (const fault of ['missing-reverse', 'extra-reverse', 'wrong-position', 'missing-forward', 'extra-forward', 'missing-source'] as const) {
	test(`Lightscaper native stack full authentication refuses actual ${fault} corruption without repairing authority`, () => {
		const db = seeded();
		try {
			const current = save(db, stack(), null, options()), key = photoStorageKey(CATALOG, current.id);
			if (fault === 'missing-reverse') db.prepare(`DELETE FROM ${REVERSE} WHERE photo_key=?`).run(photoStorageKey(CATALOG, ids(0)[0]!));
			if (fault === 'missing-forward') db.prepare(`DELETE FROM ${FORWARD} WHERE photo_key=?`).run(photoStorageKey(CATALOG, ids(0)[0]!));
			if (fault === 'wrong-position') db.prepare(`UPDATE ${REVERSE} SET member_position=2 WHERE photo_key=?`).run(photoStorageKey(CATALOG, ids(0)[0]!));
			if (fault === 'extra-reverse' || fault === 'extra-forward') db.prepare(`INSERT INTO ${fault === 'extra-reverse' ? REVERSE : FORWARD}(photo_key,catalog_id,photo_id,stack_key,stack_id,member_position) VALUES(?,?,?,?,?,2)`)
				.run(photoStorageKey(CATALOG, ids(2)[0]!), CATALOG, ids(2)[0]!, key, current.id);
			if (fault === 'missing-source') { db.exec('PRAGMA foreign_keys=OFF'); db.prepare('DELETE FROM native_photos WHERE photo_id=?').run(ids(0)[0]); db.exec('PRAGMA foreign_keys=ON'); }
			const before = groups(db), epochs = scalar(db), photos = sourceBytes(db);
			assert.throws(() => load(db, CATALOG, current.id));
			assert.throws(() => save(db, current, 0, options(2, 1)));
			assert.throws(() => dissolve(db, CATALOG, current.id, 0, options(2, 1)));
			assert.deepEqual(groups(db), before); assert.deepEqual(scalar(db), epochs); assert.deepEqual(sourceBytes(db), photos); assert.equal(db.isTransaction, false);
		} finally { db.close(); }
	});
}

for (const relation of [GROUPS, FORWARD, REVERSE]) {
	test(`Lightscaper native stack zero state refuses retained ${relation} with bounded existence probes`, () => {
		const db = seeded();
		try {
			const current = save(db, stack(), null, options());
			if (relation !== GROUPS) {
				db.exec('PRAGMA foreign_keys=OFF'); db.prepare(`DELETE FROM ${GROUPS} WHERE stack_key=?`).run(photoStorageKey(CATALOG, current.id));
				db.exec(`DELETE FROM ${relation === FORWARD ? REVERSE : FORWARD}`); db.exec('PRAGMA foreign_keys=ON');
			}
			db.exec(`UPDATE ${STATES} SET stack_count=0`); const before = groups(db);
			assert.throws(() => state(db, CATALOG)); assert.deepEqual(groups(db), before);
		} finally { db.close(); }
	});
}

test('Lightscaper native stack context refuses missing state missing query build and impossible scalar counts', () => {
	for (const fault of ['state', 'query', 'stack-count', 'query-count', 'ready-query-count'] as const) {
		const db = seeded();
		try {
			if (fault === 'state') db.exec(`DELETE FROM ${STATES}`);
			if (fault === 'query') db.exec('DELETE FROM native_photo_query_builds_v2');
			if (fault === 'stack-count') db.exec(`UPDATE ${STATES} SET stack_count=4`);
			if (fault === 'query-count') db.exec('UPDATE native_photo_query_builds_v2 SET indexed_count=7');
			if (fault === 'ready-query-count') db.exec('UPDATE native_photo_query_builds_v2 SET ready=1');
			assert.throws(() => state(db, CATALOG)); assert.throws(() => save(db, stack(), null, options())); assert.equal(count(db, GROUPS), 0);
		} finally { db.close(); }
	}
});

test('Lightscaper native stack source document changes regenerate forward facts and cannot bless stale reverse rows', () => {
	const db = seeded();
	try {
		const current = save(db, stack(), null, options());
		const changed = { ...current, photoIds: ids(1, 2), coverPhotoId: ids(2)[0] };
		db.prepare(`UPDATE ${GROUPS} SET document=?,cover_photo_id=? WHERE stack_key=?`).run(JSON.stringify(changed), changed.coverPhotoId!, photoStorageKey(CATALOG, current.id));
		assert.deepEqual(db.prepare(`SELECT photo_id FROM ${FORWARD} ORDER BY member_position`).all().map(row => row.photo_id), ids(1, 2));
		assert.throws(() => load(db, CATALOG, current.id));
	} finally { db.close(); }
});

test('Lightscaper native stack internal root index state CAS detects native trigger interference and rolls back every relation', () => {
	for (const target of ['index', 'state'] as const) {
		const db = seeded();
		try {
			const before = groups(db), epochs = scalar(db);
			db.exec(`CREATE TRIGGER interfere_stack BEFORE INSERT ON ${GROUPS} BEGIN ${target === 'index'
				? 'UPDATE native_photo_catalogs SET index_revision=index_revision+1' : `UPDATE ${STATES} SET revision=revision+1`}; END`);
			assert.throws(() => save(db, stack(), null, options()));
			assert.deepEqual(groups(db), before); assert.deepEqual(scalar(db), epochs); assert.equal(db.isTransaction, false);
		} finally { db.close(); }
	}
});

test('Lightscaper native stack actual reverse SQL failure rolls back document engine forward facts and all epochs', () => {
	const db = seeded();
	try {
		const before = groups(db), epochs = scalar(db), photos = sourceBytes(db);
		db.exec(`CREATE TRIGGER refuse_stack_reverse BEFORE INSERT ON ${REVERSE} BEGIN SELECT RAISE(ABORT,'owned reverse failure'); END`);
		assert.throws(() => save(db, stack(), null, options()), /owned reverse failure/u);
		assert.deepEqual(groups(db), before); assert.deepEqual(scalar(db), epochs); assert.deepEqual(sourceBytes(db), photos); assert.equal(db.isTransaction, false);
	} finally { db.close(); }
});

test('Lightscaper native stack native opaque abort before commit rolls back and late abort preserves completed ACK', () => {
	const db = seeded(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque read'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	try {
		const before = groups(db), epochs = scalar(db);
		db.function('owned_stop_stack', () => { stop.abort(reason); return 0; });
		db.exec(`CREATE TRIGGER stop_stack AFTER INSERT ON ${REVERSE} BEGIN SELECT owned_stop_stack(); END`);
		let failure: unknown; try { save(db, stack(), null, { ...options(), signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(traps, 0); assert.deepEqual(groups(db), before); assert.deepEqual(scalar(db), epochs);
		db.exec('DROP TRIGGER stop_stack'); const late = new AbortController();
		const receipt = save(db, stack(), null, { ...options(), signal: late.signal }); late.abort();
		assert.deepEqual(load(db, CATALOG, receipt.id), receipt); assert.equal(state(db, CATALOG).revision, 1);
	} finally { db.close(); }
});

test('Lightscaper native stack two actual connections fence stale root and state while allowing legitimate independent photo edits', async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper stack writers '))), path = join(directory, 'catalog.sqlite3');
	const first = seeded(6, path), second = new DatabaseSync(path);
	try {
		initializeLightscaperNativeCatalogDatabaseCurrentV1(second);
		const photo = nativePhotoCurrentV1(5), edit = await admitLightscaperNativeCatalogPhotosCurrentV1(second, [{ ...photo, rating: 4 }], 'edit', {});
		saveLightscaperNativePhotoCurrentV1(second, edit, 0);
		assert.deepEqual({ ...scalar(first) }, { root_revision: 1, index_revision: 2, photo_count: 6 });
		save(first, stack(), null, options()); assert.equal(scalar(first)?.index_revision, 3);
		assert.throws(() => save(second, stack([2, 3], 'stack-b'), null, options()), { code: 'CATALOG_REVISION_CONFLICT' });
		assert.throws(() => save(second, stack([2, 3], 'stack-b'), null, options(2, 0)), { code: 'STACK_REVISION_CONFLICT' });
		assert.equal(save(second, stack([2, 3], 'stack-b'), null, options(2, 1)).revision, 0);
		assert.equal(state(first, CATALOG).stackCount, 2); assert.equal(state(first, CATALOG).revision, 2);
	} finally { second.close(); first.close(); await rm(directory, { recursive: true, force: false }); }
});

test('Lightscaper native stack common authentication composes only inside one caller snapshot', () => {
	const db = seeded();
	try {
		const current = save(db, stack(), null, options());
		assert.throws(() => capture(db, CATALOG), /transaction|snapshot/iu);
		snapshot(db, () => { const context = capture(db, CATALOG); assert.equal(context.state.revision, 1); authenticate(db, current); });
	} finally { db.close(); }
});

for (const relation of [GROUPS, FORWARD, REVERSE]) {
	test(`Lightscaper native stack zero transition refuses retained ${relation} and rolls back dissolution`, () => {
		const db = seeded();
		try {
			const selected = save(db, stack(), null, options());
			const other = save(db, stack([2, 3], 'stack-b'), null, options(2, 1));
			const otherKey = photoStorageKey(CATALOG, other.id);
			if (relation === GROUPS) {
				for (const table of [FORWARD, REVERSE]) db.prepare(`DELETE FROM ${table} WHERE stack_key=?`).run(otherKey);
			} else {
				db.exec('PRAGMA foreign_keys=OFF'); db.prepare(`DELETE FROM ${GROUPS} WHERE stack_key=?`).run(otherKey);
				db.prepare(`DELETE FROM ${relation === FORWARD ? REVERSE : FORWARD} WHERE stack_key=?`).run(otherKey);
				db.exec('PRAGMA foreign_keys=ON');
			}
			db.exec(`UPDATE ${STATES} SET stack_count=1`);
			const before = groups(db), epochs = scalar(db), photos = sourceBytes(db);
			assert.throws(() => dissolve(db, CATALOG, selected.id, 0, options(3, 2)), /empty|retained/iu);
			assert.deepEqual(groups(db), before); assert.deepEqual(scalar(db), epochs); assert.deepEqual(sourceBytes(db), photos); assert.equal(db.isTransaction, false);
		} finally { db.close(); }
	});
}
