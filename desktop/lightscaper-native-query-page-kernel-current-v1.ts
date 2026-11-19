/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { lightscaperNativeQueryFileNameKeyCurrentV1, readLightscaperNativeQueryBuildCurrentV1,
	readLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';
import { PhotoCatalogRevisionConflictError, type PhotoCatalogIndexStateV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { photoQueryRowKeyV2, photoQuerySummaryV2, type PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { PHOTO_QUERY_LIMITS_V2, photoQueryDigestV2, type PhotoCatalogQueryV2, type PhotoQueryContinuationV2,
	type PhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';

const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const QUERY_COLUMNS = 'photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort';
const BUILD_COLUMNS = 'catalog_id,ready,after_key,indexed_count';

/** Fixed Query2 scanner shared by ordinary and saved readers. Caller owns the
 * actual SQLite snapshot; no public matcher, storage profile or inclusive flag. */
export function readLightscaperNativeQueryInTransactionCurrentV1(database: DatabaseSync, root: Readonly<PhotoCatalogRootV1>,
	index: Readonly<PhotoCatalogIndexStateV1>, query: PhotoCatalogQueryV2, continuation: PhotoQueryContinuationV2 | null,
	signal?: AbortSignal, position?: PhotoQueryInclusivePosition): PhotoQueryPageV2 {
	if (!database.isTransaction) throw new Error('Native Query2 scanner requires one caller snapshot.');
	check(signal); const catalogId = root.id;
	if (index.id !== catalogId || index.rootRevision !== root.revision || index.photoCount !== root.photoCount) throw new TypeError('Native Query2 root and index disagree.');
	if (continuation && (continuation.catalogRevision !== root.revision || continuation.indexRevision !== index.indexRevision)) {
		throw new PhotoCatalogRevisionConflictError('catalog');
	}
	const rawBuild = database.prepare(`SELECT ${BUILD_COLUMNS} FROM native_photo_query_builds_v2 WHERE catalog_id=?`).get(catalogId);
	if (rawBuild === undefined) throw new PhotoQueryIndexNotReadyError();
	const build = readLightscaperNativeQueryBuildCurrentV1(rawBuild, catalogId);
	if (!build.ready) throw new PhotoQueryIndexNotReadyError();
	if (build.indexedCount !== root.photoCount) throw new TypeError('Ready native query count disagrees with its catalog.');
	const bucket = continuation?.captureBucket ?? position?.captureBucket ?? 0;
	const result = scan(database, catalogId, query, bucket, continuation?.afterKey ?? null, photoQueryMatcherV2(root, query), signal, continuation === null ? position : undefined);
	const nextBucket = result.exhausted && query.sort.field === 'capture-time' && bucket === 0;
	const next = !result.exhausted || nextBucket ? Object.freeze({ schemaVersion: 2 as const, kind: 'photo-query' as const,
		catalogId, catalogRevision: root.revision, indexRevision: index.indexRevision, querySha256: photoQueryDigestV2(query),
		captureBucket: nextBucket ? 1 as const : bucket, afterKey: nextBucket ? null : result.lastKey }) : null;
	return Object.freeze({ schemaVersion: 2, kind: 'photo-query-page', catalogId, catalogName: root.name, totalCount: root.photoCount,
		catalogRevision: root.revision, indexRevision: index.indexRevision, items: Object.freeze(result.items), scanned: result.scanned, continuation: next });
}

interface Scan {
	readonly items: PhotoQueryPageV2['items'][number][];
	readonly scanned: number;
	readonly lastKey: readonly (string | number)[] | null;
	readonly exhausted: boolean;
}
function scan(database: DatabaseSync, catalogId: string, query: PhotoCatalogQueryV2, bucket: 0 | 1,
	after: readonly (string | number)[] | null, matches: (row: PhotoQueryRowV2) => boolean, signal?: AbortSignal, position?: PhotoQueryInclusivePosition): Scan {
	const { sql, parameters } = scanStatement(catalogId, query, bucket, after, position);
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

function scanStatement(catalogId: string, query: PhotoCatalogQueryV2, bucket: 0 | 1, after: readonly (string | number)[] | null, position?: PhotoQueryInclusivePosition): Readonly<{ sql: string; parameters: SQLInputValue[] }> {
	const field = query.sort.field, descending = query.sort.direction === 'descending';
	const direction = descending ? 'DESC' : 'ASC', inclusive = after === null && position !== undefined;
	const comparison = descending ? inclusive ? '<=' : '<' : inclusive ? '>=' : '>';
	const selected = after ?? position?.key ?? null;
	const columns = field === 'file-name' ? ['file_name_key', 'photo_id'] : field === 'rating' ? ['rating_sort', 'photo_id']
		: field === 'capture-time' ? ['capture_sort', 'photo_id'] : ['photo_id'];
	const where = ['catalog_id=?'], parameters: SQLInputValue[] = [catalogId];
	if (field === 'capture-time') { where.push('capture_bucket=?'); parameters.push(bucket); }
	if (selected !== null) {
		const values = field === 'file-name' ? [lightscaperNativeQueryFileNameKeyCurrentV1(selected[1] as string), selected.at(-1)!]
			: field === 'capture-time' ? selected.slice(2) : selected.slice(1);
		where.push(columns.length === 1 ? `${columns[0]!} ${comparison} ?` : `(${columns.join(',')}) ${comparison} (?,?)`);
		parameters.push(...values);
	}
	parameters.push(PHOTO_QUERY_LIMITS_V2.candidates);
	return { sql: `SELECT ${QUERY_COLUMNS} FROM native_photo_query_rows_v2 WHERE ${where.join(' AND ')}
		ORDER BY ${columns.map(column => `${column} ${direction}`).join(',')} LIMIT ?`, parameters };
}

function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
