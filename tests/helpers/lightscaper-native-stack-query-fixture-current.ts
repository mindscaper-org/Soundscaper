/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1 } from '../../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from '../../desktop/lightscaper-native-query-records-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../../src/lightscaper/catalog/photo-document-json-v1.ts';
import { photoStorageKey, photoSummary } from '../../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoStackV1, serializePhotoStackV1, type PhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import { projectPhotoQueryRowV2, type PhotoQueryRowV2 } from '../../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoQueryMatcherV2 } from '../../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { normalizePhotoCatalogQueryV2, type PhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoStackQueryPageV2, PhotoStackQueryPageRequestV2, PhotoStackQueryContinuationV2 } from '../../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './lightscaper-native-catalog-fixture-current.ts';

export const CATALOG = 'catalog';
export const photoId = (index: number) => `photo-${String(index).padStart(6, '0')}`;
export const key = (index: number) => photoStorageKey(CATALOG, photoId(index));
export type NativeStackQueryReaderCurrentV1 = (database: DatabaseSync, catalog: string, options?: PhotoStackQueryPageRequestV2) => PhotoStackQueryPageV2;
export interface NativeStackQueryGroupCurrentV1 { readonly indices: readonly number[]; readonly cover: number; readonly id?: string }
export interface NativeStackQuerySeedOptionsCurrentV1 {
	readonly groups?: readonly NativeStackQueryGroupCurrentV1[];
	readonly patch?: (photo: PhotoDocumentCurrentV1, index: number) => PhotoDocumentCurrentV1;
}
export function stackQueryCurrentV1(change: Readonly<Record<string, unknown>> = {}): PhotoCatalogQueryV2 {
	return normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', ...change });
}
export async function nativeStackQueryFixtureCurrentV1(run: (database: DatabaseSync, path: string) => void | Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native collapsed query ü '))), path = join(directory, 'catalog.sqlite3');
	const database = new DatabaseSync(path, { allowExtension: false });
	try { initializeLightscaperNativeCatalogDatabaseCurrentV1(database); database.exec('PRAGMA journal_mode=WAL'); await run(database, path); }
	finally { database.setAuthorizer(null); database.close(); await rm(directory, { recursive: true, force: false }); }
}
export function seedNativeStackQueryCurrentV1(database: DatabaseSync, count = 130, options: NativeStackQuerySeedOptionsCurrentV1 = {}) {
	const photos = Array.from({ length: count }, (_, index) => {
		const value = nativePhotoCurrentV1(index);
		const base = normalizePhotoDocumentCurrentV1({ ...value, flag: index % 2 === 0 ? 'pick' : 'unflagged', colorLabel: index % 3 === 0 ? 'blue' : 'none',
			metadata: { ...value.metadata, fileName: `Photo ${String(index).padStart(6, '0')}.png`, title: index === 129 ? 'Sparse token' : 'Ordinary',
				iso: index === count - 1 ? 800 : 200, cameraMake: index % 2 === 0 ? 'Canon' : 'Nikon', copyright: index % 3 === 0 ? 'Café Photographer' : '' } });
		return options.patch ? options.patch(base, index) : base;
	});
	const root = normalizePhotoCatalogRootV1({ ...nativeCatalogRootCurrentV1(), revision: 3, photoCount: count });
	const rows = photos.map(projectPhotoQueryRowV2), groups = options.groups ?? [];
	const stacks = groups.map((group, index) => normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: CATALOG,
		id: group.id ?? `stack-${String(index).padStart(6, '0')}`, revision: 0, photoIds: group.indices.map(photoId), coverPhotoId: photoId(group.cover) }));
	database.exec('BEGIN IMMEDIATE');
	try {
		database.prepare('INSERT INTO native_photo_catalogs(id,document,root_revision,photo_count,index_revision) VALUES(?,?,?,?,?)').run(CATALOG, json(root), 3, count, 11);
		database.prepare('INSERT INTO native_photo_query_builds_v2(catalog_id,ready,after_key,indexed_count) VALUES(?,1,NULL,?)').run(CATALOG, count);
		const putPhoto = database.prepare('INSERT INTO native_photos(photo_key,catalog_id,photo_id,revision,document,summary) VALUES(?,?,?,?,?,?)');
		for (const photo of [...photos].reverse()) {
			putPhoto.run(photoStorageKey(CATALOG, photo.id), CATALOG, photo.id, photo.revision, json(photo), json(photoSummary(photo)));
			writeNativeStackQueryRowCurrentV1(database, projectPhotoQueryRowV2(photo));
		}
		database.prepare('INSERT INTO native_photo_stack_states(catalog_id,revision,stack_count) VALUES(?,5,?)').run(CATALOG, stacks.length);
		const putStack = database.prepare('INSERT INTO native_photo_stacks(stack_key,catalog_id,stack_id,revision,document,photo_count,cover_photo_id) VALUES(?,?,?,?,?,?,?)');
		const putReverse = database.prepare('INSERT INTO native_photo_stack_memberships(photo_key,catalog_id,photo_id,stack_key,stack_id,member_position) VALUES(?,?,?,?,?,?)');
		for (const stack of [...stacks].reverse()) {
			const stackKey = photoStorageKey(CATALOG, stack.id);
			// Genuine schema3 triggers own forward projection; reverse facts stay independent.
			putStack.run(stackKey, CATALOG, stack.id, stack.revision, serializePhotoStackV1(stack), stack.photoIds.length, stack.coverPhotoId);
			stack.photoIds.forEach((id, position) => putReverse.run(photoStorageKey(CATALOG, id), CATALOG, id, stackKey, stack.id, position));
		}
		database.exec('COMMIT');
	} catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
	return { root, photos, rows, stacks };
}
export function writeNativeStackQueryRowCurrentV1(database: DatabaseSync, row: PhotoQueryRowV2): void {
	database.prepare(`INSERT INTO native_photo_query_rows_v2(photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort)
		VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(photo_key) DO UPDATE SET photo_revision=excluded.photo_revision,row_json=excluded.row_json,
		file_name_key=excluded.file_name_key,capture_bucket=excluded.capture_bucket,capture_sort=excluded.capture_sort,rating_sort=excluded.rating_sort`)
		.run(row.key, row.catalogId, row.photoId, row.photoRevision, json(row), lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort), row.captureBucket, row.captureSort, row.ratingSort);
}
export function compareNativeStackQueryRowsCurrentV1(left: PhotoQueryRowV2, right: PhotoQueryRowV2, query: PhotoCatalogQueryV2): number {
	const { field, direction } = query.sort, factor = direction === 'ascending' ? 1 : -1;
	if (field === 'capture-time' && left.captureBucket !== right.captureBucket) return left.captureBucket - right.captureBucket;
	const a = field === 'file-name' ? left.fileNameSort : field === 'capture-time' ? left.captureSort : left.photoId;
	const b = field === 'file-name' ? right.fileNameSort : field === 'capture-time' ? right.captureSort : right.photoId;
	const first = field === 'rating' ? left.rating - right.rating : a < b ? -1 : a > b ? 1 : 0;
	return factor * (first || (left.photoId < right.photoId ? -1 : left.photoId > right.photoId ? 1 : 0));
}
export function expectedNativeStackQueryCurrentV1(fixture: ReturnType<typeof seedNativeStackQueryCurrentV1>, query: PhotoCatalogQueryV2): string[] {
	const matches = photoQueryMatcherV2(fixture.root, query), rows = [...fixture.rows].sort((a, b) => compareNativeStackQueryRowsCurrentV1(a, b, query));
	const owner = new Map<string, Readonly<PhotoStackV1>>();
	for (const stack of fixture.stacks) for (const id of stack.photoIds) owner.set(id, stack);
	const representatives = new Map<string, string>();
	for (const stack of fixture.stacks) {
		const eligible = rows.filter(row => stack.photoIds.includes(row.photoId) && matches(row));
		const cover = eligible.find(row => row.photoId === stack.coverPhotoId), winner = cover ?? eligible[0];
		if (winner) representatives.set(stack.id, winner.photoId);
	}
	return rows.filter(row => matches(row) && (!owner.has(row.photoId) || representatives.get(owner.get(row.photoId)!.id) === row.photoId)).map(row => row.photoId);
}
export function collectNativeStackQueryCurrentV1(database: DatabaseSync, query: PhotoCatalogQueryV2, read: NativeStackQueryReaderCurrentV1) {
	const ids: string[] = [], pages: PhotoStackQueryPageV2[] = []; let continuation: PhotoStackQueryContinuationV2 | null = null;
	do {
		const page = read(database, CATALOG, { query, continuation });
		assert.ok(page.scanned >= 0 && page.scanned <= 64); assert.ok(page.items.length <= 64); assert.ok(pages.length < 1200, 'Signed bounded progress must advance.');
		assert.equal(database.isTransaction, false);
		if (page.continuation) assert.ok(Buffer.byteLength(JSON.stringify(page.continuation), 'utf8') <= 4096);
		ids.push(...page.items.map(item => item.photoId)); pages.push(page); continuation = page.continuation;
	} while (continuation);
	return { ids, pages };
}
export function forbidNativeStackQueryAggregatesCurrentV1(database: DatabaseSync): void {
	database.setAuthorizer((action, table, column) => {
		if (action === constants.SQLITE_READ && table === 'native_photos' && column === 'document') return constants.SQLITE_DENY;
		if (action === constants.SQLITE_FUNCTION && column?.toLowerCase() === 'count') return constants.SQLITE_DENY;
		return constants.SQLITE_OK;
	});
}

/** Observes genuine native statements/results. No rows, SQL or iterator outcomes
 * are synthesized; every call still uses the actual SQLite receiver. */
export function observeNativeStackQueryReadsCurrentV1(database: DatabaseSync) {
	const original = database.prepare, delivered: string[] = []; let audited = 0, returned = 0;
	database.prepare = function (...parameters: Parameters<typeof original>) {
		const [sql] = parameters, statement = original.apply(database, parameters);
		const queryRows = /\bFROM\s+native_photo_query_rows_v2\b/iu.test(sql), stackKeys = /\bFROM\s+native_photo_stacks\b/iu.test(sql) && !/\bdocument\b/iu.test(sql);
		if (!queryRows && !stackKeys) return statement;
		const record = (row: Record<string, SQLOutputValue> | undefined): void => {
			if (row === undefined) return;
			if (queryRows && typeof row.photo_id === 'string') delivered.push(row.photo_id);
			else if (stackKeys && typeof row.stack_key === 'string') audited++;
		};
		type Argument = SQLInputValue | Record<string, SQLInputValue>;
		const get = statement.get.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.get>;
		const all = statement.all.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.all>;
		const iterate = statement.iterate.bind(statement) as (...args: Argument[]) => ReturnType<typeof statement.iterate>;
		statement.get = function (...args: Argument[]) { const row = get(...args); record(row); return row; };
		statement.all = function (...args: Argument[]) { const rows = all(...args); rows.forEach(record); return rows; };
		statement.iterate = function (...args: Argument[]) {
			const iterator = iterate(...args), next = iterator.next.bind(iterator), close = iterator.return?.bind(iterator);
			iterator.next = function () { const step = next(); if (step.done !== true) record(step.value); return step; };
			if (close) iterator.return = function () { returned++; return close(); };
			return iterator;
		};
		return statement;
	};
	return { delivered, get audited() { return audited; }, get returned() { return returned; }, restore() { database.prepare = original; } };
}
