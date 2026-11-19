/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { captureLightscaperNativeStackGroupingContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { readLightscaperNativeStackQueryInTransactionCurrentV1 } from './lightscaper-native-stack-query-kernel-current-v1.ts';
import { authenticateLightscaperNativeStackQueryProgressCurrentV1, issueLightscaperNativeStackQueryProgressCurrentV1 } from './lightscaper-native-stack-query-progress-current-v1.ts';
import { admitPhotoStackQueryPageRequestV2, type AdmittedPhotoStackQueryPageRequestV2,
	type PhotoStackQueryPageV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

export interface AdmittedLightscaperNativeStackQueryPageCurrentV1 extends AdmittedPhotoStackQueryPageRequestV2 { readonly catalogId: string }
const admittedPages = new WeakSet<AdmittedLightscaperNativeStackQueryPageCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** The queued owner registers its operation before invoking this synchronous
 * capture. Caller query/continuation objects cannot change while waiting. */
export function admitLightscaperNativeStackQueryPageCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeStackQueryPageCurrentV1 {
	const catalog = id(catalogId, 'collapsed native query catalog ID'), value = admitPhotoStackQueryPageRequestV2(catalog, options);
	const result = Object.freeze({ catalogId: catalog, ...value }); admittedPages.add(result); return result;
}
export function readLightscaperNativeStackQueryPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoStackQueryPageV2 {
	return readAdmittedLightscaperNativeStackQueryPageCurrentV1(database, admitLightscaperNativeStackQueryPageCurrentV1(catalogId, options));
}

/** One actual deferred SQLite transaction authenticates root/index/state,
 * readiness and all emitted representative metadata. Incoming HMAC authority
 * is checked before BEGIN; only the final escaping progress is signed. */
export function readAdmittedLightscaperNativeStackQueryPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeStackQueryPageCurrentV1): PhotoStackQueryPageV2 {
	if (!admittedPages.has(request)) throw new TypeError('Collapsed native query requires its owning admitted request.');
	const { catalogId, query, continuation, signal } = request;
	check(signal); authenticateLightscaperNativeStackQueryProgressCurrentV1(database, continuation);
	if (database.isTransaction) throw new Error('Collapsed native query requires its own serialized snapshot transaction.');
	database.exec('BEGIN');
	try {
		const context = captureLightscaperNativeStackGroupingContextCurrentV1(database, catalogId);
		const result = readLightscaperNativeStackQueryInTransactionCurrentV1(database, context, query, continuation, signal);
		const next = result.continuation === null ? null : issueLightscaperNativeStackQueryProgressCurrentV1(database, result.continuation, query);
		const page: PhotoStackQueryPageV2 = Object.freeze({ schemaVersion: 2, kind: 'collapsed-photo-query-page', catalogId, ...result, continuation: next });
		check(signal); database.exec('COMMIT'); return page;
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Collapsed native query read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
