/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';
import { seekLightscaperNativeLegacyQueryRowCurrentV1 } from './lightscaper-native-legacy-query-seek-current-v1.ts';
import { PhotoCatalogRevisionConflictError, type PhotoCatalogIndexStateV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import { photoQueryMatcherV1 } from '../src/lightscaper/catalog/photo-query-matcher-v1.ts';
import { photoQueryRowKeyV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { normalizePhotoCatalogQueryV1, PHOTO_QUERY_LIMITS_V1 as LIMITS, photoQueryDigestV1, readPhotoQueryContinuationV1,
	type PhotoCatalogQueryV1, type PhotoQueryContinuationV1, type PhotoQueryPageV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

export interface AdmittedLightscaperNativeLegacyQueryPageCurrentV1 {
	readonly catalogId: string; readonly query: PhotoCatalogQueryV1; readonly continuation: PhotoQueryContinuationV1 | null; readonly signal?: AbortSignal;
}
const admittedPages = new WeakSet<AdmittedLightscaperNativeLegacyQueryPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** Queue ownership registers first; this whole inert snapshot precedes waits. */
export function admitLightscaperNativeLegacyQueryPageCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeLegacyQueryPageCurrentV1 {
	const catalog = id(catalogId, 'native legacy query catalog'), input = record(options, 'native legacy query request', ['query','continuation','signal'], []);
	const query = normalizePhotoCatalogQueryV1(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const raw = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = raw === null || raw === undefined ? null : readPhotoQueryContinuationV1(raw, catalog, query);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const result = Object.freeze({ catalogId: catalog, query, continuation, ...(signal === undefined ? {} : { signal }) }); admittedPages.add(result); return result;
}
export function readLightscaperNativeLegacyQueryPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoQueryPageV1 {
	return readAdmittedLightscaperNativeLegacyQueryPageCurrentV1(database, admitLightscaperNativeLegacyQueryPageCurrentV1(catalogId, options));
}
export function readAdmittedLightscaperNativeLegacyQueryPageCurrentV1(database: DatabaseSync, request: AdmittedLightscaperNativeLegacyQueryPageCurrentV1): PhotoQueryPageV1 {
	if (!admittedPages.has(request)) throw new TypeError('Native legacy query requires its owning admitted request.');
	const { catalogId, query, continuation, signal } = request; check(signal);
	if (database.isTransaction) throw new Error('Native legacy query requires its own serialized snapshot transaction.');
	database.exec('BEGIN');
	try {
		const raw = database.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(catalogId);
		if (raw === undefined) throw new ReferenceError('Photo catalog is missing.');
		const { root, index } = readLightscaperNativeCatalogRowCurrentV1(raw, catalogId);
		const result = readLightscaperNativeLegacyQueryInTransactionCurrentV1(database, root, index, query, continuation, signal);
		check(signal); database.exec('COMMIT'); return result;
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error,cleanup], 'Native legacy query read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}

/** Private culling seam: the owning caller audits its Current point and derives
 * the inclusive position inside this same transaction. No public flag exists.
 * Public V1 positions retain index-only revision proof and their exact DTO. */
export function readLightscaperNativeLegacyQueryInTransactionCurrentV1(database: DatabaseSync, root: Readonly<PhotoCatalogRootV1>,
	index: Readonly<PhotoCatalogIndexStateV1>, query: PhotoCatalogQueryV1, continuation: PhotoQueryContinuationV1 | null,
	signal?: AbortSignal, position?: PhotoQueryInclusivePosition): PhotoQueryPageV1 {
	if (!database.isTransaction) throw new Error('Native legacy scanner requires one caller snapshot.'); check(signal);
	const catalogId = root.id;
	if (index.id !== catalogId || index.rootRevision !== root.revision || index.photoCount !== root.photoCount) throw new TypeError('Native legacy query root and index disagree.');
	if (continuation && continuation.indexRevision !== index.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
	const build = getLightscaperNativeLegacyQueryBuildCurrentV1(database, catalogId);
	if (!build?.ready) throw new PhotoQueryIndexNotReadyError();
	if (build.indexedCount !== root.photoCount) throw new TypeError('Ready native legacy query count disagrees with its catalog.');
	const matches = photoQueryMatcherV1(root, query), bucket = continuation?.captureBucket ?? position?.captureBucket ?? 0;
	let after = continuation?.afterKey ?? null, inclusive = continuation === null ? position : undefined;
	const items: PhotoQueryPageV1['items'][number][] = []; let scanned = 0, exhausted = false, lastKey: readonly (string | number)[] | null = null;
	while (scanned < LIMITS.candidates) {
		check(signal); const row = seekLightscaperNativeLegacyQueryRowCurrentV1(database, catalogId, query, bucket, after, inclusive); inclusive = undefined;
		if (row === null) { exhausted = true; break; }
		scanned++; lastKey = Object.freeze(photoQueryRowKeyV1(row, query.sort.field)); after = lastKey;
		if (matches(row)) items.push(row.summary);
	}
	const nextBucket = exhausted && query.sort.field === 'capture-time' && bucket === 0;
	const next: PhotoQueryContinuationV1 | null = !exhausted || nextBucket ? Object.freeze({ schemaVersion: 1, catalogId,
		indexRevision: index.indexRevision, querySha256: photoQueryDigestV1(query), captureBucket: nextBucket ? 1 : bucket, afterKey: nextBucket ? null : lastKey }) : null;
	return Object.freeze({ items: Object.freeze(items), scanned,
		continuation: next === null ? null : readPhotoQueryContinuationV1(next, catalogId, query) });
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
