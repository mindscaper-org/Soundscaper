/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1, readLightscaperNativeQueryBuildCurrentV1,
	readLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { photoQueryRowKeyV2, photoQuerySummaryV2, type PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { admitPhotoQueryPageRequestV2, PHOTO_QUERY_LIMITS_V2, photoQueryDigestV2,
	type AdmittedPhotoQueryPageRequestV2, type PhotoCatalogQueryV2, type PhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

export interface AdmittedLightscaperNativeQueryPageCurrentV1 extends AdmittedPhotoQueryPageRequestV2 {
	readonly catalogId: string;
}
const admittedPages = new WeakSet<AdmittedLightscaperNativeQueryPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const ROOT_COLUMNS = 'id,document,root_revision,photo_count,index_revision';
const QUERY_COLUMNS = 'photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort';
const BUILD_COLUMNS = 'catalog_id,ready,after_key,indexed_count';

/** The queued owner registers first, then captures this whole inert request
 * before waiting. Keep the genuine packet; it is not an IPC protocol. */
export function admitLightscaperNativeQueryPageCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeQueryPageCurrentV1 {
	const catalog = id(catalogId, 'query catalog ID'), value = admitPhotoQueryPageRequestV2(catalog, options);
	const result = Object.freeze({ catalogId: catalog, ...value }); admittedPages.add(result); return result;
}

export function readLightscaperNativeQueryPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoQueryPageV2 {
	return readAdmittedLightscaperNativeQueryPageCurrentV1(database, admitLightscaperNativeQueryPageCurrentV1(catalogId, options));
}

/** One actual SQLite snapshot binds root/index, build readiness and at most64
 * candidate rows. Only one full Query2 row is materialized per iterator step. */
export function readAdmittedLightscaperNativeQueryPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeQueryPageCurrentV1): PhotoQueryPageV2 {
	if (!admittedPages.has(request)) throw new TypeError('Native Query2 pages require their owning admitted request.');
	const { catalogId, query, continuation, signal } = request;
	return readTransaction(database, signal, () => {
		const rawRoot = database.prepare(`SELECT ${ROOT_COLUMNS} FROM native_photo_catalogs WHERE id=?`).get(catalogId);
		if (rawRoot === undefined) throw new ReferenceError('Photo catalog is missing.');
		const { root, index } = readLightscaperNativeCatalogRowCurrentV1(rawRoot, catalogId);
		if (continuation && (continuation.catalogRevision !== root.revision || continuation.indexRevision !== index.indexRevision)) {
			throw new PhotoCatalogRevisionConflictError('catalog');
		}
		const rawBuild = database.prepare(`SELECT ${BUILD_COLUMNS} FROM native_photo_query_builds_v2 WHERE catalog_id=?`).get(catalogId);
		if (rawBuild === undefined) throw new PhotoQueryIndexNotReadyError();
		const build = readLightscaperNativeQueryBuildCurrentV1(rawBuild, catalogId);
		if (!build.ready) throw new PhotoQueryIndexNotReadyError();
		if (build.indexedCount !== root.photoCount) throw new TypeError('Ready native query count disagrees with its catalog.');
		const bucket = continuation?.captureBucket ?? 0;
		const result = scan(database, catalogId, query, bucket, continuation?.afterKey ?? null, photoQueryMatcherV2(root, query), signal);
		const nextBucket = result.exhausted && query.sort.field === 'capture-time' && bucket === 0;
		const next = !result.exhausted || nextBucket ? Object.freeze({ schemaVersion: 2 as const, kind: 'photo-query' as const,
			catalogId, catalogRevision: root.revision, indexRevision: index.indexRevision, querySha256: photoQueryDigestV2(query),
			captureBucket: nextBucket ? 1 as const : bucket, afterKey: nextBucket ? null : result.lastKey }) : null;
		return Object.freeze({ schemaVersion: 2, kind: 'photo-query-page', catalogId, catalogName: root.name, totalCount: root.photoCount,
			catalogRevision: root.revision, indexRevision: index.indexRevision, items: Object.freeze(result.items), scanned: result.scanned, continuation: next });
	});
}

interface Scan {
	readonly items: PhotoQueryPageV2['items'][number][];
	readonly scanned: number;
	readonly lastKey: readonly (string | number)[] | null;
	readonly exhausted: boolean;
}
function scan(database: DatabaseSync, catalogId: string, query: PhotoCatalogQueryV2, bucket: 0 | 1,
	after: readonly (string | number)[] | null, matches: (row: PhotoQueryRowV2) => boolean, signal?: AbortSignal): Scan {
	const { sql, parameters } = scanStatement(catalogId, query, bucket, after);
	const iterator = database.prepare(sql).iterate(...parameters);
	const items: Scan['items'] = []; let scanned = 0, exhausted = false, lastKey: Scan['lastKey'] = null;
	let primary: unknown, failed = false;
	try {
		while (scanned < PHOTO_QUERY_LIMITS_V2.candidates) {
			check(signal); const step = iterator.next();
			if (step.done === true) { exhausted = true; break; }
			const row = readLightscaperNativeQueryRowCurrentV1(step.value);
			if (row.catalogId !== catalogId || query.sort.field === 'capture-time' && row.captureBucket !== bucket) {
				throw new TypeError('Native Query2 row leaves its selected catalog or capture bucket.');
			}
			scanned += 1; lastKey = Object.freeze(photoQueryRowKeyV2(row, query.sort.field));
			if (matches(row)) items.push(photoQuerySummaryV2(row));
		}
	} catch (error) { failed = true; primary = error; }
	// An exact64-row limit still needs native iterator retirement before COMMIT.
	// Explicit cleanup preserves a primary parse/abort failure if return also fails.
	if (!exhausted) {
		try {
			const ended = iterator.return?.();
			if (!ended || ended.done !== true) throw new Error('Native Query2 cursor retirement is unproved.');
		} catch (cleanup) { throw new AggregateError(failed ? [primary, cleanup] : [cleanup], 'Native Query2 cursor retirement failed.', { cause: cleanup }); }
	}
	if (failed) throw primary;
	return { items, scanned, lastKey, exhausted };
}

function scanStatement(catalogId: string, query: PhotoCatalogQueryV2, bucket: 0 | 1, after: readonly (string | number)[] | null): Readonly<{ sql: string; parameters: SQLInputValue[] }> {
	const field = query.sort.field, descending = query.sort.direction === 'descending';
	const direction = descending ? 'DESC' : 'ASC', comparison = descending ? '<' : '>';
	const columns = field === 'file-name' ? ['file_name_key', 'photo_id'] : field === 'rating' ? ['rating_sort', 'photo_id']
		: field === 'capture-time' ? ['capture_sort', 'photo_id'] : ['photo_id'];
	const where = ['catalog_id=?'], parameters: SQLInputValue[] = [catalogId];
	if (field === 'capture-time') { where.push('capture_bucket=?'); parameters.push(bucket); }
	if (after !== null) {
		const values = field === 'file-name' ? [lightscaperNativeQueryFileNameKeyCurrentV1(after[1] as string), after.at(-1)!]
			: field === 'capture-time' ? after.slice(2) : after.slice(1);
		where.push(columns.length === 1 ? `${columns[0]!} ${comparison} ?` : `(${columns.join(',')}) ${comparison} (?,?)`);
		parameters.push(...values);
	}
	parameters.push(PHOTO_QUERY_LIMITS_V2.candidates);
	return { sql: `SELECT ${QUERY_COLUMNS} FROM native_photo_query_rows_v2 WHERE ${where.join(' AND ')}
		ORDER BY ${columns.map(column => `${column} ${direction}`).join(',')} LIMIT ?`, parameters };
}

function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
function readTransaction<T>(database: DatabaseSync, signal: AbortSignal | undefined, run: () => T): T {
	check(signal);
	if (database.isTransaction) throw new Error('Native Query2 read requires its own serialized transaction.');
	database.exec('BEGIN');
	try { const result = run(); check(signal); database.exec('COMMIT'); return result; }
	catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native Query2 read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
