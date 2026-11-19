/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { admitLightscaperNativeQueryPageCurrentV1, readAdmittedLightscaperNativeQueryPageCurrentV1,
	readLightscaperNativeQueryPageCurrentV1 } from '../desktop/lightscaper-native-query-pages-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { projectPhotoQueryRowV2, type PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { normalizePhotoCatalogQueryV2, photoQueryDigestV2, readPhotoQueryContinuationV2,
	type PhotoCatalogQueryV2, type PhotoQueryContinuationV2, type PhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const NAMES = ['A.jpg', 'same.jpg', 'İ.jpg', '😀.jpg', '\uE000.jpg', '💡.jpg', 'é.jpg', 'Z.jpg', '\ud800.jpg', '\udc00.jpg'];
function photo(index: number) {
	const previous = queryPhotoV1(index);
	return normalizePhotoDocumentCurrentV1({ ...previous, flag: index % 2 === 0 ? 'pick' : 'unflagged',
		colorLabel: index % 3 === 0 ? 'blue' : 'none', folderId: index % 4 === 0 ? null : 'folder',
		metadata: { ...previous.metadata, fileName: NAMES[index % NAMES.length], title: index === 129 ? 'Sparse token' : 'Ordinary',
			cameraMake: index % 2 === 0 ? 'Canon' : 'Nikon', iso: index % 4 === 0 ? 800 : null,
			copyright: index % 3 === 0 ? 'Café Photographer' : '' } });
}
function query(change: Record<string, unknown> = {}): PhotoCatalogQueryV2 {
	return normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', ...change });
}
async function fixture(run: (database: DatabaseSync, path: string) => void | Promise<void>): Promise<void> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native query ü '))), path = join(root, 'catalog.sqlite3');
	const database = new DatabaseSync(path, { allowExtension: false });
	try { initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec('PRAGMA journal_mode=WAL'); await run(database, path); }
	finally { database.setAuthorizer(null); database.close(); await rm(root, { recursive: true, force: false }); }
}
function seed(database: DatabaseSync, photos: readonly PhotoDocumentCurrentV1[] = Array.from({ length: 130 }, (_, index) => photo(index))) {
	const root = normalizePhotoCatalogRootV1({ ...queryCatalogRootV1(), revision: 3, photoCount: photos.length });
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, json(root), root.revision, root.photoCount, 11);
	const insertPhoto = database.prepare('INSERT INTO native_photos VALUES (?,?,?,?,?,?)');
	const insertRow = database.prepare(`INSERT INTO native_photo_query_rows_v2
		(photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort) VALUES (?,?,?,?,?,?,?,?,?)`);
	for (const document of [...photos].reverse()) {
		const row = projectPhotoQueryRowV2(document);
		insertPhoto.run(row.key, row.catalogId, row.photoId, row.photoRevision, json(document), json(photoSummary(document)));
		insertRow.run(row.key, row.catalogId, row.photoId, row.photoRevision, json(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
	}
	database.prepare('INSERT INTO native_photo_query_builds_v2 (catalog_id,ready,after_key,indexed_count) VALUES (?,1,NULL,?)').run(root.id, root.photoCount);
	return { root, photos, rows: photos.map(projectPhotoQueryRowV2) };
}
function ordered(rows: readonly PhotoQueryRowV2[], selected: PhotoCatalogQueryV2): readonly PhotoQueryRowV2[] {
	const { field, direction } = selected.sort, factor = direction === 'ascending' ? 1 : -1;
	return [...rows].sort((left, right) => {
		if (field === 'capture-time' && left.captureBucket !== right.captureBucket) return left.captureBucket - right.captureBucket;
		const a = field === 'file-name' ? left.fileNameSort : field === 'capture-time' ? left.captureSort : left.photoId;
		const b = field === 'file-name' ? right.fileNameSort : field === 'capture-time' ? right.captureSort : right.photoId;
		const primary = field === 'rating' ? left.rating - right.rating : a < b ? -1 : a > b ? 1 : 0;
		return factor * (primary || (left.photoId < right.photoId ? -1 : left.photoId > right.photoId ? 1 : 0));
	});
}
function collect(database: DatabaseSync, selected: PhotoCatalogQueryV2) {
	const ids: string[] = [], pages: PhotoQueryPageV2[] = []; let continuation: PhotoQueryContinuationV2 | null = null;
	do {
		const page = readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { query: selected, continuation });
		assert.ok(page.scanned <= 64 && page.items.length <= page.scanned); assert.ok(pages.length < 20, 'Continuation must make bounded progress.');
		if (page.continuation) assert.deepEqual(readPhotoQueryContinuationV2(page.continuation, 'catalog', selected), page.continuation);
		ids.push(...page.items.map(item => item.photoId)); pages.push(page); continuation = page.continuation;
	} while (continuation);
	return { ids, pages };
}

test('Lightscaper native Query2 preserves every sort direction, UTF16 filename ordering and ties without aggregate reads', async () => {
	await fixture(database => {
		const f = seed(database); let forbidden = 0;
		database.setAuthorizer((action, table, column) => {
			if (action === constants.SQLITE_READ && table === 'native_photos' && column === 'document') { forbidden += 1; return constants.SQLITE_DENY; }
			return constants.SQLITE_OK;
		});
		for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
			const selected = query({ sort: { field, direction } }), result = collect(database, selected);
			assert.deepEqual(result.ids, ordered(f.rows, selected).map(row => row.photoId));
			assert.equal(new Set(result.ids).size, 130); assert.equal(forbidden, 0); assert.equal(database.isTransaction, false);
		}
		assert.ok('😀.jpg' < '\uE000.jpg', 'Fixture distinguishes JS code units from UTF8/codepoint SQL text sorting.');
		const page = readLightscaperNativeQueryPageCurrentV1(database, 'catalog');
		assert.deepEqual(Object.keys(page).sort(), ['catalogId', 'catalogName', 'catalogRevision', 'continuation', 'indexRevision', 'items', 'kind', 'scanned', 'schemaVersion', 'totalCount'].sort());
		assert.equal(page.schemaVersion, 2); assert.equal(page.kind, 'photo-query-page'); assert.equal(page.catalogName, f.root.name);
		assert.equal(page.catalogRevision, 3); assert.equal(page.indexRevision, 11); assert.equal(page.totalCount, 130);
		assert.equal(Object.isFrozen(page), true); assert.equal(Object.isFrozen(page.items), true);
	});
});

test('Lightscaper native Query2 folded512-unit filename emits reusable UTF16 BLOB continuation', async () => {
	await fixture(database => {
		const fileName = 'İ'.repeat(256), photos = Array.from({ length: 65 }, (_, index) => {
			const before = photo(index); return normalizePhotoDocumentCurrentV1({ ...before, metadata: { ...before.metadata, fileName } });
		});
		seed(database, photos); const selected = query({ sort: { field: 'file-name', direction: 'ascending' } });
		const first = readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { query: selected });
		assert.equal(first.scanned, 64); assert.equal(first.continuation?.afterKey?.[1], fileName.toLowerCase());
		assert.equal(lightscaperNativeQueryFileNameKeyCurrentV1(fileName.toLowerCase()).byteLength, 1024);
		const next = readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { query: selected, continuation: first.continuation });
		assert.equal(next.scanned, 1); assert.equal(next.items[0]?.photoId, 'photo-000064'); assert.equal(next.continuation, null);
	});
});

test('Lightscaper native Query2 scans candidates instead of filling sparse matches and preserves empty continuations', async () => {
	await fixture(database => {
		seed(database); const selected = query({ text: 'Sparse token' }), result = collect(database, selected);
		assert.deepEqual(result.ids, ['photo-000129']); assert.deepEqual(result.pages.map(page => page.scanned), [64, 64, 2]);
		assert.deepEqual(result.pages.map(page => page.items.length), [0, 0, 1]);
		assert.deepEqual(result.pages[0]?.continuation?.afterKey, ['catalog', 'photo-000063']);
	});
	await fixture(database => {
		seed(database, Array.from({ length: 64 }, (_, index) => photo(index)));
		const result = collect(database, query()); assert.deepEqual(result.pages.map(page => page.scanned), [64, 0]); assert.equal(result.pages[1]?.continuation, null);
	});
});

test('Lightscaper native Query2 crosses dated then unknown capture buckets in both directions with truthful empty steps', async () => {
	for (const direction of ['ascending', 'descending'] as const) await fixture(database => {
		const photos = Array.from({ length: 65 }, (_, index) => {
			const before = photo(index); return normalizePhotoDocumentCurrentV1({ ...before, metadata: { ...before.metadata,
				captureTime: index === 64 ? null : { local: '2026-01-01T12:00:00.000', offsetMinutes: null } } });
		});
		seed(database, photos); const selected = query({ sort: { field: 'capture-time', direction } }), result = collect(database, selected);
		assert.deepEqual(result.pages.map(page => page.scanned), [64, 0, 1]);
		assert.equal(result.pages[0]?.continuation?.captureBucket, 0); assert.equal(result.pages[1]?.continuation?.captureBucket, 1);
		assert.equal(result.pages[1]?.continuation?.afterKey, null); assert.equal(result.ids.at(-1), 'photo-000064');
	});
});

test('Lightscaper native Query2 delegates all scalar filters, Unicode text and nested metadata/legacy smart predicates to existing semantics', async () => {
	await fixture(database => {
		const f = seed(database);
		const selections = [
			...([{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }, { kind: 'collection', id: 'manual' },
				{ kind: 'collection', id: 'smart' }, { kind: 'rating', value: 5 }, { kind: 'flag', value: 'pick' }, { kind: 'label', value: 'blue' }].map(filter => query({ filter }))),
			query({ text: 'LANDSCAPE' }), query({ text: 'Sparse token' }), query({ predicate: { kind: 'all', terms: [
				{ kind: 'any', terms: [{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' }, { kind: 'number', column: 'iso', minimum: 400, maximum: 1600 }] },
				{ kind: 'not', term: { kind: 'presence', column: 'iso', value: 'unknown' } },
				{ kind: 'text', column: 'copyright', operator: 'contains', value: 'CAFÉ' },
			] } }),
		];
		for (const selected of selections) {
			const expected = ordered(f.rows, selected).filter(photoQueryMatcherV2(f.root, selected)).map(row => row.photoId);
			if (selected.predicate !== null) assert.ok(expected.length > 0, 'Nested metadata fixture must exercise actual positive matches.');
			assert.deepEqual(collect(database, selected).ids, expected);
		}
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { query: query({ filter: { kind: 'keyword', id: 'missing' } }) }), ReferenceError);
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native Query2 refuses missing, unready and inconsistent builds without scanning source aggregates', async () => {
	await fixture(database => {
		seed(database); database.exec('DELETE FROM native_photo_query_builds_v2');
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
		database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES (?,0,NULL,?)').run('catalog', 130);
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
		database.exec('UPDATE native_photo_query_builds_v2 SET ready=1,indexed_count=129');
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog'), /count|catalog/iu);
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'missing'), ReferenceError); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native Query2 refuses stale root/index and foreign query or continuation identities', async () => {
	await fixture(database => {
		const f = seed(database), selected = query(), first = readLightscaperNativeQueryPageCurrentV1(database, 'catalog'); assert.ok(first.continuation);
		assert.equal(first.continuation.querySha256, photoQueryDigestV2(selected));
		for (const changed of [{ catalogId: 'other' }, { kind: 'collapsed-photo-query' }, { afterKey: ['other', 'photo-000063'] }]) {
			assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { continuation: { ...first.continuation!, ...changed } }));
		}
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { query: query({ text: 'changed' }), continuation: first.continuation }));
		database.exec('UPDATE native_photo_catalogs SET index_revision=12');
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		database.prepare('UPDATE native_photo_catalogs SET index_revision=11,root_revision=4,document=?').run(json({ ...f.root, revision: 4 }));
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native Query2 rejects selected-row sort/revision corruption and never reaches a later corrupt page early', async () => {
	await fixture(database => {
		const f = seed(database), first = f.rows[0]!, last = f.rows.at(-1)!;
		for (const [column, changed, original] of [
			['rating_sort', (first.ratingSort + 1) % 6, first.ratingSort], ['photo_revision', 1, first.photoRevision],
			['file_name_key', lightscaperNativeQueryFileNameKeyCurrentV1('wrong'), lightscaperNativeQueryFileNameKeyCurrentV1(first.fileNameSort)],
		] as const) {
			database.prepare(`UPDATE native_photo_query_rows_v2 SET ${column}=? WHERE photo_key=?`).run(changed, first.key);
			assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog')); assert.equal(database.isTransaction, false);
			database.prepare(`UPDATE native_photo_query_rows_v2 SET ${column}=? WHERE photo_key=?`).run(original, first.key);
		}
		database.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_key=?').run('{broken', last.key);
		const page = readLightscaperNativeQueryPageCurrentV1(database, 'catalog'); assert.equal(page.scanned, 64);
		const next = readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { continuation: page.continuation }); assert.equal(next.scanned, 64);
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { continuation: next.continuation }));
	});
});

test('Lightscaper native Query2 captures requests before waits, rejects getters, and rolls back native cancellation', async () => {
	await fixture(database => {
		seed(database); const borrowed = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Sparse token' };
		const admitted = admitLightscaperNativeQueryPageCurrentV1('catalog', { query: borrowed }); borrowed.text = 'Ordinary';
		assert.equal(readAdmittedLightscaperNativeQueryPageCurrentV1(database, admitted).items.length, 0);
		assert.equal(admitted.query.text, 'sparse token'); let invoked = 0;
		assert.throws(() => admitLightscaperNativeQueryPageCurrentV1('catalog', { get query() { invoked++; return query(); } })); assert.equal(invoked, 0);
		const cancel = new AbortController(), reason = Object.freeze({ source: 'native-query-cancel' });
		database.setAuthorizer((action, table) => { if (action === constants.SQLITE_READ && table === 'native_photo_query_rows_v2') cancel.abort(reason); return constants.SQLITE_OK; });
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { signal: cancel.signal }), (error: unknown) => error === reason);
		assert.equal(database.isTransaction, false); database.setAuthorizer(null);
		assert.throws(() => readLightscaperNativeQueryPageCurrentV1(database, 'catalog', { signal: cancel.signal }), (error: unknown) => error === reason);
	});
});

test('Lightscaper native Query2 root/build/scalar page retain one WAL snapshot across a real competing commit', async () => {
	await fixture((database, path) => {
		const f = seed(database), writer = new DatabaseSync(path, { allowExtension: false }); let changed = false;
		try {
			database.setAuthorizer((action, table) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photo_query_rows_v2') {
					changed = true; const before = f.photos[0]!, updated = normalizePhotoDocumentCurrentV1({ ...before, revision: 1 }), row = projectPhotoQueryRowV2(updated);
					writer.exec('BEGIN IMMEDIATE');
					writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4,index_revision=12 WHERE id=?').run(json({ ...f.root, revision: 4, name: 'New snapshot' }), f.root.id);
					writer.prepare('UPDATE native_photos SET document=?,summary=?,revision=1 WHERE photo_key=?').run(json(updated), json(photoSummary(updated)), row.key);
					writer.prepare('UPDATE native_photo_query_rows_v2 SET row_json=?,photo_revision=1 WHERE photo_key=?').run(json(row), row.key);
					writer.exec('COMMIT');
				}
				return constants.SQLITE_OK;
			});
			const page = readLightscaperNativeQueryPageCurrentV1(database, 'catalog');
			assert.equal(changed, true); assert.equal(page.catalogRevision, 3); assert.equal(page.indexRevision, 11); assert.equal(page.items[0]?.photoRevision, 0);
			database.setAuthorizer(null); const next = readLightscaperNativeQueryPageCurrentV1(database, 'catalog');
			assert.equal(next.catalogRevision, 4); assert.equal(next.indexRevision, 12); assert.equal(next.items[0]?.photoRevision, 1); assert.equal(database.isTransaction, false);
		} finally { database.setAuthorizer(null); writer.close(); }
	});
});
