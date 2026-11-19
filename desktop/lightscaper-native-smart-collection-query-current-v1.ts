/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 } from './lightscaper-native-smart-collection-context-current-v1.ts';
import { captureLightscaperNativeStackGroupingContextCurrentV1 } from './lightscaper-native-stack-auth-current-v1.ts';
import { readLightscaperNativeQueryInTransactionCurrentV1 } from './lightscaper-native-query-page-kernel-current-v1.ts';
import { readLightscaperNativeStackQueryInTransactionCurrentV1, type LightscaperNativeStackQueryProgressCurrentV1 } from './lightscaper-native-stack-query-kernel-current-v1.ts';
import { authenticateLightscaperNativeSavedQueryProgressCurrentV1 as authenticate, issueLightscaperNativeSavedQueryProgressCurrentV1 as issue,
	lightscaperNativeSavedDefinitionDigestCurrentV1 } from './lightscaper-native-smart-collection-query-progress-current-v1.ts';
import { validatePhotoSmartCollectionReferencesV1 } from '../src/lightscaper/catalog/photo-smart-collection-references-v1.ts';
import { PhotoSmartCollectionRevisionConflictError } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { admitPhotoSavedQueryPageRequestV1, type PhotoSavedQueryPageV1, type PhotoSavedQueryModeV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { photoQueryDigestV2, type PhotoQueryContinuationV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { oneOf } from '../src/lightscaper/catalog/value-validation.ts';

export type AdmittedLightscaperNativeSmartCollectionQueryCurrentV1 = ReturnType<typeof admitPhotoSavedQueryPageRequestV1>;
const admitted = new WeakSet<AdmittedLightscaperNativeSmartCollectionQueryCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

export function admitLightscaperNativeSmartCollectionQueryCurrentV1(catalogId: string, collectionId: string,
	mode: PhotoSavedQueryModeV1, options: unknown = {}): AdmittedLightscaperNativeSmartCollectionQueryCurrentV1 {
	const result = admitPhotoSavedQueryPageRequestV1(catalogId, collectionId, oneOf(mode, ['ordinary', 'collapsed'] as const, 'saved query mode'), options);
	admitted.add(result); return result;
}
export function readLightscaperNativeSmartCollectionQueryPageCurrentV1(database: DatabaseSync, catalogId: string, collectionId: string, options: unknown = {}): PhotoSavedQueryPageV1 {
	return readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1(database, admitLightscaperNativeSmartCollectionQueryCurrentV1(catalogId, collectionId, 'ordinary', options));
}
export function readLightscaperNativeSmartCollectionStackQueryPageCurrentV1(database: DatabaseSync, catalogId: string, collectionId: string, options: unknown = {}): PhotoSavedQueryPageV1 {
	return readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1(database, admitLightscaperNativeSmartCollectionQueryCurrentV1(catalogId, collectionId, 'collapsed', options));
}

/** One native snapshot owns selected recipe/reference proof and fixed Row2
 * traversal. Only the escaping saved envelope is signed; transient kernel
 * progress never receives independent public authority. */
export function readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeSmartCollectionQueryCurrentV1): PhotoSavedQueryPageV1 {
	if (!admitted.has(request)) throw new TypeError('Native saved query requires its owning admitted request.');
	const { catalogId, collectionId, mode, continuation, signal } = request;
	check(signal); authenticate(database, continuation);
	if (database.isTransaction) throw new Error('Native saved query requires its own serialized snapshot.');
	database.exec('BEGIN');
	try {
		const context = captureLightscaperNativeSmartCollectionContextCurrentV1(database, catalogId, collectionId), definition = context.definition;
		if (definition === null) throw new ReferenceError('Selected saved collection is missing.');
		validatePhotoSmartCollectionReferencesV1(definition, context.root);
		const query = definition.query, definitionSha256 = lightscaperNativeSavedDefinitionDigestCurrentV1(definition), querySha256 = photoQueryDigestV2(query);
		if (continuation) {
			if (continuation.definitionRevision !== definition.revision || continuation.collectionStateRevision !== context.state.revision
				|| continuation.catalogRevision !== context.root.revision || continuation.indexRevision !== context.index.indexRevision) throw new PhotoSmartCollectionRevisionConflictError();
			if (continuation.definitionSha256 !== definitionSha256 || continuation.querySha256 !== querySha256
				|| JSON.stringify(continuation.sort) !== JSON.stringify(query.sort)) throw new TypeError('Saved query definition or query digest changed.');
		}
		const identity = { catalogId, collectionId, definitionRevision: definition.revision, collectionStateRevision: context.state.revision,
			definitionSha256, querySha256, catalogRevision: context.root.revision, indexRevision: context.index.indexRevision };
		let items: PhotoSavedQueryPageV1['items'], scanned: number, next: PhotoSavedQueryPageV1['continuation'], stackStateRevision: number | null;
		if (mode === 'ordinary') {
			const incoming: PhotoQueryContinuationV2 | null = continuation === null ? null : { schemaVersion: 2, kind: 'photo-query', catalogId,
				catalogRevision: continuation.catalogRevision, indexRevision: continuation.indexRevision, querySha256,
				captureBucket: continuation.captureBucket, afterKey: continuation.afterKey };
			const result = readLightscaperNativeQueryInTransactionCurrentV1(database, context.root, context.index, query, incoming, signal);
			items = result.items; scanned = result.scanned; stackStateRevision = null;
			next = result.continuation === null ? null : issue(database, { schemaVersion: 1, kind: 'saved-photo-query', mode, ...identity,
				sort: query.sort, captureBucket: result.continuation.captureBucket, afterKey: result.continuation.afterKey, stackStateRevision, pending: null, stackAudit: null });
		} else {
			const grouping = captureLightscaperNativeStackGroupingContextCurrentV1(database, catalogId);
			const incoming: LightscaperNativeStackQueryProgressCurrentV1 | null = continuation === null ? null : { schemaVersion: 2, kind: 'collapsed-photo-query',
				catalogId, catalogRevision: continuation.catalogRevision, indexRevision: continuation.indexRevision, querySha256,
				captureBucket: continuation.captureBucket, afterKey: continuation.afterKey, stateRevision: continuation.stackStateRevision!, pending: continuation.pending, stackAudit: continuation.stackAudit };
			const result = readLightscaperNativeStackQueryInTransactionCurrentV1(database, grouping, query, incoming, signal);
			items = result.items; scanned = result.scanned; stackStateRevision = result.stateRevision;
			next = result.continuation === null ? null : issue(database, { schemaVersion: 1, kind: 'saved-photo-query', mode, ...identity,
				sort: query.sort, captureBucket: result.continuation.captureBucket, afterKey: result.continuation.afterKey, stackStateRevision,
				pending: result.continuation.pending, stackAudit: result.continuation.stackAudit });
		}
		const page: PhotoSavedQueryPageV1 = Object.freeze({ schemaVersion: 1, kind: 'saved-photo-query-page', mode, ...identity,
			catalogName: context.root.name, totalCount: context.root.photoCount, collectionName: definition.name, stackStateRevision, items, scanned, continuation: next });
		check(signal); database.exec('COMMIT'); return page;
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native saved query read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
