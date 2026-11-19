/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, constants } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { admitLightscaperNativeStackPageCurrentV1, admitLightscaperNativeStackMemberPageCurrentV1,
	readAdmittedLightscaperNativeStackMembershipPageCurrentV1, readAdmittedLightscaperNativeStackMemberPageCurrentV1,
	readLightscaperNativeStackPageCurrentV1, readLightscaperNativeStackMembershipPageCurrentV1,
	readLightscaperNativeStackMemberPageCurrentV1 } from '../desktop/lightscaper-native-stack-pages-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoStackV1, serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import type { PhotoStackContinuationV1 } from '../src/lightscaper/catalog/photo-stack-repository-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

async function fixture(run: (database: DatabaseSync, path: string) => void | Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native stack pages ü '))), path = join(directory, 'catalog.sqlite3');
	const database = new DatabaseSync(path, { allowExtension: false });
	try { initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec('PRAGMA journal_mode=WAL'); await run(database, path); }
	finally { database.setAuthorizer(null); database.close(); await rm(directory, { recursive: true, force: false }); }
}
function seed(database: DatabaseSync, stackCount = 65, members = 2, unstacked = 0) {
	const total = stackCount * members + unstacked, root = normalizePhotoCatalogRootV1({ ...queryCatalogRootV1(), revision: 3, photoCount: total });
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, json(root), 3, total, 11);
	database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,1,NULL,?)').run(root.id, total);
	const insertPhoto = database.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)');
	const insertQuery = database.prepare(`INSERT INTO native_photo_query_rows_v2
		(photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort) VALUES (?,?,?,?,?,?,?,?,?)`);
	for (let index = 0; index < total; index++) {
		const document = queryPhotoV1(index), row = projectPhotoQueryRowV2(document);
		insertPhoto.run(row.key, row.catalogId, row.photoId, row.photoRevision, json(document), json(photoSummary(document)));
		insertQuery.run(row.key, row.catalogId, row.photoId, row.photoRevision, json(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
	}
	database.prepare('INSERT INTO native_photo_stack_states (catalog_id,revision,stack_count) VALUES (?,?,?)').run(root.id, 5, stackCount);
	const insertStack = database.prepare('INSERT INTO native_photo_stacks (stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id) VALUES (?,?,?,?,?,?,?)');
	const insertReverse = database.prepare('INSERT INTO native_photo_stack_memberships (photo_key,catalog_id,photo_id,stack_key,stack_id,member_position) VALUES (?,?,?,?,?,?)');
	const stacks = Array.from({ length: stackCount }, (_, index) => {
		const photoIds = Array.from({ length: members }, (_, offset) => queryPhotoV1(index * members + offset).id);
		return normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
			id: `stack-${String(index).padStart(6, '0')}`, revision: 0, photoIds, coverPhotoId: photoIds[0] });
	});
	for (const stack of [...stacks].reverse()) {
		const key = photoStorageKey(root.id, stack.id);
		// The real SQLite stack trigger, not fixture code, publishes forward rows.
		insertStack.run(key, root.id, stack.id, 0, serializePhotoStackV1(stack), stack.photoIds.length, stack.coverPhotoId);
		stack.photoIds.forEach((photoId, position) => insertReverse.run(photoStorageKey(root.id, photoId), root.id, photoId, key, stack.id, position));
	}
	return { root, stacks, total };
}
function collectMemberships(database: DatabaseSync) {
	const result: string[] = []; let continuation: PhotoStackContinuationV1 | null = null, steps = 0;
	do {
		const page = readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { continuation });
		assert.ok(page.items.length <= 64 && steps++ < 10); result.push(...page.items.map(item => item.photoId)); continuation = page.continuation;
	} while (continuation);
	return result;
}

test('Lightscaper native stack summaries preserve65 and full64 continuation pages without Photo aggregates', async () => {
	for (const count of [65, 64]) await fixture(database => {
		const f = seed(database, count); let forbidden = 0;
		database.setAuthorizer((action, table, column) => {
			if (action === constants.SQLITE_READ && table === 'native_photos' && column === 'document') { forbidden++; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		const first = readLightscaperNativeStackPageCurrentV1(database, 'catalog'); assert.equal(first.items.length, 64); assert.ok(first.continuation);
		assert.deepEqual(first.items[0], { catalogId: 'catalog', id: f.stacks[0]!.id, revision: 0, photoCount: 2, coverPhotoId: f.stacks[0]!.coverPhotoId });
		assert.deepEqual(first.continuation, { catalogId: 'catalog', scope: 'stacks', catalogRevision: 3, indexRevision: 11, stateRevision: 5, afterKey: 'catalog|stack-000063' });
		const next = readLightscaperNativeStackPageCurrentV1(database, 'catalog', { continuation: first.continuation });
		assert.equal(next.items.length, count - 64); assert.equal(next.continuation, null); assert.equal(forbidden, 0);
		assert.equal(Object.isFrozen(first.items), true); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native reverse pages and bounded point annotations preserve key order and requested order', async () => {
	await fixture(database => {
		seed(database, 65, 2, 1); assert.deepEqual(collectMemberships(database), Array.from({ length: 130 }, (_, index) => queryPhotoV1(index).id));
		const ids = [queryPhotoV1(129).id, queryPhotoV1(130).id, queryPhotoV1(0).id, queryPhotoV1(1).id];
		const page = readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { photoIds: ids });
		assert.deepEqual(page.items.map(item => item.photoId), [ids[0], ids[2], ids[3]]); assert.equal(page.continuation, null);
		assert.deepEqual(readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { photoIds: [] }), { items: [], continuation: null });
	});
	await fixture(database => {
		seed(database, 32); const first = readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog'); assert.equal(first.items.length, 64);
		assert.deepEqual(readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { items: [], continuation: null });
	});
});

test('Lightscaper native selected member summaries authenticate all1024 members and retain requested scalar order', async () => {
	await fixture(database => {
		const f = seed(database, 1, 1024), stack = f.stacks[0]!; let forbidden = 0;
		database.setAuthorizer((action, table, column) => {
			if (action === constants.SQLITE_READ && table === 'native_photos' && column === 'document') { forbidden++; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		const selected = [stack.photoIds[1023]!, stack.photoIds[0]!, stack.photoIds[50]!];
		assert.deepEqual(readLightscaperNativeStackMemberPageCurrentV1(database, 'catalog', stack.id, 0, selected), [1023, 0, 50].map(index => ({
			photoId: queryPhotoV1(index).id, fileName: queryPhotoV1(index).metadata.fileName, photoRevision: 0 })));
		assert.equal(forbidden, 0);
		assert.throws(() => readLightscaperNativeStackMemberPageCurrentV1(database, 'catalog', stack.id, 1, selected), { code: 'STACK_REVISION_CONFLICT' });
		database.prepare('DELETE FROM native_photo_stack_memberships WHERE photo_key=?').run(photoStorageKey('catalog', stack.photoIds[700]!));
		assert.throws(() => readLightscaperNativeStackMemberPageCurrentV1(database, 'catalog', stack.id, 0, [stack.photoIds[0]!]));
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native stack continuation refuses foreign scope and all three changed revision fences', async () => {
	await fixture(database => {
		const f = seed(database), first = readLightscaperNativeStackPageCurrentV1(database, 'catalog'); assert.ok(first.continuation);
		for (const changed of [{ catalogId: 'other' }, { scope: 'memberships' }, { afterKey: 'other|stack-000063' }]) {
			assert.throws(() => readLightscaperNativeStackPageCurrentV1(database, 'catalog', { continuation: { ...first.continuation!, ...changed } }));
		}
		assert.throws(() => readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { continuation: first.continuation }));
		assert.throws(() => readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { photoIds: [], continuation: first.continuation }));
		database.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4').run(json({ ...f.root, revision: 4 }));
		assert.throws(() => readLightscaperNativeStackPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { code: 'STACK_REVISION_CONFLICT' });
		database.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=3,index_revision=12').run(json(f.root));
		assert.throws(() => readLightscaperNativeStackPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { code: 'STACK_REVISION_CONFLICT' });
		database.exec('UPDATE native_photo_catalogs SET index_revision=11; UPDATE native_photo_stack_states SET revision=6');
		assert.throws(() => readLightscaperNativeStackPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { code: 'STACK_REVISION_CONFLICT' });
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native stack annotations detect missing reverse and wrong forward positions without full-catalog documents', async () => {
	await fixture(database => {
		const f = seed(database, 1), stack = f.stacks[0]!, photoId = stack.photoIds[0]!, key = photoStorageKey('catalog', photoId);
		database.prepare('DELETE FROM native_photo_stack_memberships WHERE photo_key=?').run(key);
		assert.equal(readLightscaperNativeStackPageCurrentV1(database, 'catalog').items.length, 1, 'Summary is not full reverse authentication.');
		assert.throws(() => readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { photoIds: [photoId] }));
		database.prepare('INSERT INTO native_photo_stack_memberships VALUES (?,?,?,?,?,?)').run(key, 'catalog', photoId, photoStorageKey('catalog', stack.id), stack.id, 0);
		database.prepare('UPDATE native_photo_stack_forward_members SET member_position=999 WHERE photo_key=?').run(key);
		assert.throws(() => readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { photoIds: [photoId] }));
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native stack reads refuse missing source photos and contradictory zero state', async () => {
	await fixture(database => {
		const f = seed(database, 1), stack = f.stacks[0]!, photoId = stack.photoIds[0]!;
		database.exec('PRAGMA foreign_keys=OFF'); database.prepare('DELETE FROM native_photos WHERE photo_key=?').run(photoStorageKey('catalog', photoId));
		assert.throws(() => readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { photoIds: [photoId] }), ReferenceError);
		assert.throws(() => readLightscaperNativeStackMemberPageCurrentV1(database, 'catalog', stack.id, 0, [photoId]), ReferenceError);
		database.exec('UPDATE native_photo_stack_states SET stack_count=0');
		assert.throws(() => readLightscaperNativeStackPageCurrentV1(database, 'catalog')); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native stack admissions detach point/member IDs and refuse getters and oversized requests before SQL', async () => {
	await fixture(database => {
		const f = seed(database, 1), stack = f.stacks[0]!, selected = [stack.photoIds[1]!, stack.photoIds[0]!];
		const points = admitLightscaperNativeStackPageCurrentV1('catalog', { photoIds: selected }, 'memberships');
		const members = admitLightscaperNativeStackMemberPageCurrentV1('catalog', stack.id, 0, selected); selected.reverse();
		assert.deepEqual(readAdmittedLightscaperNativeStackMembershipPageCurrentV1(database, points).items.map(item => item.photoId), [stack.photoIds[1], stack.photoIds[0]]);
		assert.deepEqual(readAdmittedLightscaperNativeStackMemberPageCurrentV1(database, members).map(item => item.photoId), [stack.photoIds[1], stack.photoIds[0]]);
		let invoked = 0;
		assert.throws(() => admitLightscaperNativeStackPageCurrentV1('catalog', { get continuation() { invoked++; return null; } }));
		assert.throws(() => admitLightscaperNativeStackMemberPageCurrentV1('catalog', stack.id, 0, selected, { get signal() { invoked++; return undefined; } }));
		assert.equal(invoked, 0); assert.throws(() => admitLightscaperNativeStackPageCurrentV1('catalog', { photoIds: Array.from({ length: 65 }, (_, index) => `p-${index}`) }, 'memberships'));
		assert.throws(() => admitLightscaperNativeStackMemberPageCurrentV1('catalog', stack.id, 0, [])); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native stack cancellation before/during cursor admission joins read rollback', async () => {
	await fixture(database => {
		seed(database); const cancel = new AbortController(), reason = Object.freeze({ source: 'native-stack-cancel' });
		database.setAuthorizer((action, table) => { if (action === constants.SQLITE_READ && table === 'native_photo_stacks') cancel.abort(reason); return constants.SQLITE_OK; });
		assert.throws(() => readLightscaperNativeStackPageCurrentV1(database, 'catalog', { signal: cancel.signal }), (error: unknown) => error === reason);
		assert.equal(database.isTransaction, false); database.setAuthorizer(null);
		assert.throws(() => readLightscaperNativeStackMembershipPageCurrentV1(database, 'catalog', { signal: cancel.signal }), (error: unknown) => error === reason);
	});
});

test('Lightscaper native stack summary fences and selected scalar photos retain actual WAL snapshots', async () => {
	await fixture((database, path) => {
		const f = seed(database), writer = new DatabaseSync(path), before = f.stacks[0]!; let changed = false;
		try {
			database.setAuthorizer((action, table) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photo_stacks') {
					changed = true; const next = normalizePhotoStackV1({ ...before, revision: 1, coverPhotoId: before.photoIds[1] }); writer.exec('BEGIN IMMEDIATE');
					writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4,index_revision=12').run(json({ ...f.root, revision: 4 }));
					writer.exec('UPDATE native_photo_stack_states SET revision=6');
					writer.prepare('UPDATE native_photo_stacks SET revision=1,document=?,cover_photo_id=? WHERE stack_key=?').run(serializePhotoStackV1(next), next.coverPhotoId, photoStorageKey('catalog', before.id));
					writer.exec('COMMIT');
				}
				return constants.SQLITE_OK;
			});
			const page = readLightscaperNativeStackPageCurrentV1(database, 'catalog'); assert.equal(changed, true);
			assert.equal(page.continuation?.catalogRevision, 3); assert.equal(page.continuation?.indexRevision, 11); assert.equal(page.continuation?.stateRevision, 5);
			assert.equal(page.items[0]?.revision, 0); database.setAuthorizer(null);
			assert.equal(readLightscaperNativeStackPageCurrentV1(database, 'catalog').items[0]?.revision, 1);
		} finally { database.setAuthorizer(null); writer.close(); }
	});
	await fixture((database, path) => {
		const f = seed(database, 1), stack = f.stacks[0]!, writer = new DatabaseSync(path); let changed = false;
		try {
			database.setAuthorizer((action, table, column) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photos' && column === 'summary') {
					changed = true; const old = queryPhotoV1(0), next = normalizePhotoDocumentCurrentV1({ ...old, revision: 1, metadata: { ...old.metadata, fileName: 'Later.jpg' } });
					writer.exec('BEGIN IMMEDIATE'); writer.exec('UPDATE native_photo_catalogs SET index_revision=12');
					writer.prepare('UPDATE native_photos SET revision=1,document=?,summary=? WHERE photo_key=?').run(json(next), json(photoSummary(next)), photoStorageKey('catalog', old.id));
					const queryRow = projectPhotoQueryRowV2(next);
					writer.prepare('UPDATE native_photo_query_rows_v2 SET photo_revision=1,row_json=?,file_name_key=? WHERE photo_key=?').run(json(queryRow), lightscaperNativeQueryFileNameKeyCurrentV1(queryRow.fileNameSort), queryRow.key);
					writer.exec('COMMIT');
				}
				return constants.SQLITE_OK;
			});
			const rows = readLightscaperNativeStackMemberPageCurrentV1(database, 'catalog', stack.id, 0, [stack.photoIds[0]!]);
			assert.equal(changed, true); assert.equal(rows[0]?.photoRevision, 0); database.setAuthorizer(null);
			assert.equal(readLightscaperNativeStackMemberPageCurrentV1(database, 'catalog', stack.id, 0, [stack.photoIds[0]!])[0]?.photoRevision, 1);
		} finally { database.setAuthorizer(null); writer.close(); }
	});
});
