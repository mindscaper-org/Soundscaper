/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { readLightscaperNativeQueryInTransactionCurrentV1 } from './lightscaper-native-query-page-kernel-current-v1.ts';
import { admitPhotoQueryPageRequestV2, type AdmittedPhotoQueryPageRequestV2, type PhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

export interface AdmittedLightscaperNativeQueryPageCurrentV1 extends AdmittedPhotoQueryPageRequestV2 {
	readonly catalogId: string;
}
const admittedPages = new WeakSet<AdmittedLightscaperNativeQueryPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const ROOT_COLUMNS = 'id,document,root_revision,photo_count,index_revision';

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
		return readLightscaperNativeQueryInTransactionCurrentV1(database, root, index, query, continuation, signal);
	});
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
