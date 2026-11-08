/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { captureLightscaperNativeStackGroupingContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { readLightscaperNativeLegacyStackQueryInTransactionCurrentV1 } from './lightscaper-native-legacy-stack-query-kernel-current-v1.ts';
import { authenticateLightscaperNativeLegacyStackQueryProgressCurrentV1, issueLightscaperNativeLegacyStackQueryProgressCurrentV1 } from './lightscaper-native-legacy-stack-query-progress-current-v1.ts';
import { admitPhotoStackQueryPageRequestV1, type PhotoStackQueryAdmittedV1,
	type PhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

export interface AdmittedLightscaperNativeLegacyStackQueryPageCurrentV1 extends PhotoStackQueryAdmittedV1 { readonly catalogId: string }
const admittedPages = new WeakSet<AdmittedLightscaperNativeLegacyStackQueryPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** The queued owner registers its operation before invoking this synchronous
 * capture. Caller query/continuation objects cannot change while waiting. */
export function admitLightscaperNativeLegacyStackQueryPageCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeLegacyStackQueryPageCurrentV1 {
	const catalog = id(catalogId, 'collapsed native query catalog ID'), value = admitPhotoStackQueryPageRequestV1(catalog, options);
	const result = Object.freeze({ catalogId: catalog, ...value }); admittedPages.add(result); return result;
}
export function readLightscaperNativeLegacyStackQueryPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoStackQueryPageV1 {
	return readAdmittedLightscaperNativeLegacyStackQueryPageCurrentV1(database, admitLightscaperNativeLegacyStackQueryPageCurrentV1(catalogId, options));
}

/** One actual deferred SQLite transaction authenticates root/index/state,
 * readiness and all emitted representative metadata. The escaping V1 page retains exactly its five fields. Incoming HMAC authority
 * is checked before BEGIN; only the final escaping progress is signed. */
export function readAdmittedLightscaperNativeLegacyStackQueryPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeLegacyStackQueryPageCurrentV1): PhotoStackQueryPageV1 {
	if (!admittedPages.has(request)) throw new TypeError('Collapsed native query requires its owning admitted request.');
	const { catalogId, query, continuation, signal } = request;
	check(signal); authenticateLightscaperNativeLegacyStackQueryProgressCurrentV1(database, continuation);
	if (database.isTransaction) throw new Error('Collapsed native query requires its own serialized snapshot transaction.');
	database.exec('BEGIN');
	try {
		const context = captureLightscaperNativeStackGroupingContextCurrentV1(database, catalogId);
		const result = readLightscaperNativeLegacyStackQueryInTransactionCurrentV1(database, context, query, continuation, signal);
		const next = result.continuation === null ? null : issueLightscaperNativeLegacyStackQueryProgressCurrentV1(database, result.continuation, query);
		const page: PhotoStackQueryPageV1 = Object.freeze({ catalogName: result.catalogName, totalCount: result.totalCount,
			items: result.items, scanned: result.scanned, continuation: next });
		check(signal); database.exec('COMMIT'); return page;
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Collapsed native query read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
