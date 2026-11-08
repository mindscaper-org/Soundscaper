/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, constants } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { admitLightscaperNativeCatalogSummaryPageCurrentV1, readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1,
	readLightscaperNativeCatalogSnapshotCurrentV1, readLightscaperNativeCatalogSummaryPageCurrentV1 } from '../desktop/lightscaper-native-catalog-pages-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { photoMemberships, photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import type { PhotoCatalogContinuationV1, PhotoCatalogFilterV1 } from '../src/lightscaper/catalog/repository-types.ts';
import { nativeCatalogRootCurrentV1 as queryCatalogRootV1, nativePhotoCurrentV1 as queryPhotoV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

async function fixture(run: (database: DatabaseSync, path: string) => Promise<void> | void): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native pages ü '))), path = join(directory, 'catalog.sqlite3');
	const database = new DatabaseSync(path, { allowExtension: false });
	try { initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec('PRAGMA journal_mode=WAL'); await run(database, path); }
	finally { database.setAuthorizer(null); if (database.isOpen) database.close(); await rm(directory, { recursive: true, force: true }); }
}
function photo(index: number, catalogId = 'catalog') {
	return normalizePhotoDocumentCurrentV1({ ...queryPhotoV1(index), catalogId,
		flag: index % 2 === 0 ? 'pick' : 'unflagged', colorLabel: index % 3 === 0 ? 'blue' : 'none' });
}
function seed(database: DatabaseSync, count = 130, catalogId = 'catalog') {
	const root = normalizePhotoCatalogRootV1({ ...queryCatalogRootV1(), id: catalogId, revision: 3, photoCount: count });
	database.prepare('INSERT INTO native_photo_catalogs (id,document,root_revision,photo_count,index_revision) VALUES (?,?,?,?,?)')
		.run(root.id, json(root), root.revision, root.photoCount, 11);
	const insert = database.prepare('INSERT INTO native_photos (photo_key,catalog_id,photo_id,revision,document,summary) VALUES (?,?,?,?,?,?)');
	const membership = database.prepare('INSERT INTO native_photo_memberships (key,scope,photo_key,catalog_id) VALUES (?,?,?,?)');
	// Reverse insertion must never become display ordering.
	for (let index = count - 1; index >= 0; index -= 1) {
		const document = photo(index, catalogId), summary = photoSummary(document);
		insert.run(summary.key, catalogId, document.id, document.revision, json(document), json(summary));
		for (const row of photoMemberships(document)) membership.run(row.key, row.scope, row.photoKey, catalogId);
	}
	return root;
}
function collect(database: DatabaseSync, filter?: PhotoCatalogFilterV1): string[] {
	const result: string[] = []; let continuation: PhotoCatalogContinuationV1 | null = null;
	do {
		const page = readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { ...(filter ? { filter } : {}), continuation });
		assert.ok(page.items.length <= 64); result.push(...page.items.map(item => item.photoId)); continuation = page.continuation;
	} while (continuation);
	return result;
}
const ids = (count: number, accepts: (index: number) => boolean = () => true) =>
	Array.from({ length: count }, (_, index) => index).filter(accepts).map(index => queryPhotoV1(index).id);

test('Lightscaper native catalog snapshot is bounded detached state and survives actual SQLite reopen', async () => {
	await fixture((database, path) => {
		assert.equal(readLightscaperNativeCatalogSnapshotCurrentV1(database, 'catalog'), null);
		const root = seed(database, 3), before = readLightscaperNativeCatalogSnapshotCurrentV1(database, 'catalog');
		assert.deepEqual(before, { catalog: root, indexRevision: 11 }); assert.equal(Object.isFrozen(before), true); assert.equal(Object.isFrozen(before?.catalog), true);
		database.prepare('UPDATE native_photo_catalogs SET index_revision = 12 WHERE id = ?').run(root.id);
		assert.equal(before?.indexRevision, 11); assert.equal(readLightscaperNativeCatalogSnapshotCurrentV1(database, root.id)?.indexRevision, 12);
		const reopened = new DatabaseSync(path, { readOnly: true, allowExtension: false });
		try { assert.deepEqual(readLightscaperNativeCatalogSnapshotCurrentV1(reopened, root.id), { catalog: root, indexRevision: 12 }); }
		finally { reopened.close(); }
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native summary pages use global key order and SQLite refuses any aggregate document read', async () => {
	await fixture(database => {
		seed(database); let denied = 0;
		database.setAuthorizer((action, table, column) => {
			if (action === constants.SQLITE_READ && table === 'native_photos' && column === 'document') { denied += 1; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		assert.deepEqual(collect(database), ids(130)); assert.equal(denied, 0);
		const page = readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog');
		assert.equal(page.items.length, 64); assert.equal(Object.isFrozen(page), true); assert.equal(Object.isFrozen(page.items), true);
		assert.equal(Object.hasOwn(page.items[0]!, 'versions'), false); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native full scalar page preserves the final empty continuation step', async () => {
	await fixture(database => {
		seed(database, 64); const first = readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog');
		assert.equal(first.items.length, 64); assert.ok(first.continuation);
		assert.deepEqual(first.continuation, { catalogId: 'catalog', indexRevision: 11, scope: 'catalog|all', afterKey: 'catalog|photo-000063' });
		assert.deepEqual(readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { items: [], continuation: null });
	});
});

test('Lightscaper native summary membership pages retain every existing scalar filter and smart refusal', async () => {
	await fixture(database => {
		seed(database);
		for (const [filter, expected] of [
			[{ kind: 'folder', id: 'folder' }, ids(130)], [{ kind: 'collection', id: 'manual' }, ids(130)],
			[{ kind: 'keyword', id: 'keyword' }, ids(130, index => index % 2 === 0)],
			[{ kind: 'rating', value: 5 }, ids(130, index => index % 6 === 5)],
			[{ kind: 'flag', value: 'pick' }, ids(130, index => index % 2 === 0)],
			[{ kind: 'label', value: 'blue' }, ids(130, index => index % 3 === 0)],
		] as const) assert.deepEqual(collect(database, filter), expected);
		assert.deepEqual(collect(database, { kind: 'folder', id: 'missing' }), []);
		assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { filter: { kind: 'collection', id: 'smart' } }), /smart.*query/iu);
	});
});

test('Lightscaper native continuation rejects scope substitutions and index-only stale state', async () => {
	await fixture(database => {
		seed(database); const first = readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog'); assert.ok(first.continuation);
		for (const changed of [{ catalogId: 'other' }, { scope: 'catalog|rating|5' }, { afterKey: 'other|photo-000063' }, { afterKey: 'catalog|../file' }]) {
			assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { continuation: { ...first.continuation!, ...changed } }));
		}
		assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { filter: { kind: 'flag', value: 'pick' }, continuation: first.continuation }));
		database.exec('UPDATE native_photo_catalogs SET index_revision = index_revision + 1');
		assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		assert.equal(readLightscaperNativeCatalogSnapshotCurrentV1(database, 'catalog')?.catalog.revision, 3); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native page admission detaches borrowed filters and never invokes getters', async () => {
	await fixture(database => {
		seed(database); const filter = { kind: 'rating' as const, value: 5 };
		const admitted = admitLightscaperNativeCatalogSummaryPageCurrentV1('catalog', { filter }); filter.value = 0;
		assert.deepEqual(readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1(database, admitted).items.map(item => item.photoId), ids(130, index => index % 6 === 5));
		let invoked = 0; const hostile = { get filter() { invoked += 1; return filter; } };
		assert.throws(() => admitLightscaperNativeCatalogSummaryPageCurrentV1('catalog', hostile)); assert.equal(invoked, 0);
		const cancel = new AbortController(), reason = Object.freeze({ source: 'pre-aborted-native-read' }); cancel.abort(reason);
		assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { signal: cancel.signal }), (error: unknown) => error === reason);
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native snapshot and scalar rows refuse mismatched persisted identity and release read transactions', async () => {
	await fixture(database => {
		const root = seed(database, 1), key = photoStorageKey(root.id, queryPhotoV1().id), summary = photoSummary(photo(0));
		database.prepare('UPDATE native_photos SET summary = ? WHERE photo_key = ?').run(json({ ...summary, photoId: 'other', key: 'catalog|other' }), key);
		assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, root.id)); assert.equal(database.isTransaction, false);
		database.prepare('UPDATE native_photos SET summary = ? WHERE photo_key = ?').run(json(summary), key);
		for (const column of ['root_revision', 'photo_count'] as const) {
			database.exec(`UPDATE native_photo_catalogs SET ${column} = ${column} + 1`);
			assert.throws(() => readLightscaperNativeCatalogSnapshotCurrentV1(database, root.id));
			assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, root.id));
			database.exec(`UPDATE native_photo_catalogs SET ${column} = ${column} - 1`);
		}
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native filtered page refuses a dangling membership instead of silently dropping it', async () => {
	await fixture(database => {
		seed(database, 1); database.exec('PRAGMA foreign_keys=OFF');
		database.prepare('UPDATE native_photo_memberships SET photo_key = ?, key = ? WHERE scope = ?')
			.run('catalog|missing', 'catalog|keyword|keyword|missing', 'catalog|keyword|keyword');
		assert.throws(() => readLightscaperNativeCatalogSummaryPageCurrentV1(database, 'catalog', { filter: { kind: 'keyword', id: 'keyword' } }));
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native root and summary page keep one actual WAL snapshot during another connection commit', async () => {
	await fixture((database, path) => {
		const root = seed(database), writer = new DatabaseSync(path, { allowExtension: false }); let changed = false;
		try {
			database.setAuthorizer((action, table) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photos') {
					changed = true;
					const old = photo(0), updated = normalizePhotoDocumentCurrentV1({ ...old, revision: 1, metadata: { ...old.metadata, fileName: 'Changed after snapshot.jpg' } });
					writer.exec('BEGIN IMMEDIATE');
					writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=?,index_revision=? WHERE id=?').run(json({ ...root, revision: 4, name: 'After snapshot' }), 4, 12, root.id);
					writer.prepare('UPDATE native_photos SET document=?,summary=?,revision=? WHERE photo_key=?').run(json(updated), json(photoSummary(updated)), 1, photoStorageKey(root.id, old.id));
					writer.exec('COMMIT');
				}
				return constants.SQLITE_OK;
			});
			const page = readLightscaperNativeCatalogSummaryPageCurrentV1(database, root.id);
			assert.equal(changed, true); assert.equal(page.continuation?.indexRevision, 11); assert.equal(page.items[0]?.photoRevision, 0);
			assert.equal(page.items[0]?.fileName, photo(0).metadata.fileName); assert.equal(database.isTransaction, false);
			database.setAuthorizer(null);
			assert.equal(readLightscaperNativeCatalogSnapshotCurrentV1(database, root.id)?.indexRevision, 12);
			assert.equal(readLightscaperNativeCatalogSummaryPageCurrentV1(database, root.id).items[0]?.photoRevision, 1);
		} finally { database.setAuthorizer(null); writer.close(); }
	});
});
