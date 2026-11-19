/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 } from './lightscaper-native-smart-collection-context-current-v1.ts';
import { LIGHTSCAPER_NATIVE_SMART_COLLECTION_SUMMARY_COLUMNS_CURRENT_V1 as COLUMNS,
	readLightscaperNativeSmartCollectionSummaryRowCurrentV1 } from './lightscaper-native-smart-collection-records-current-v1.ts';
import { admitPhotoSmartCollectionSnapshotRequestV1, admitPhotoSmartCollectionArchiveContextRequestV1,
	type PhotoSmartCollectionSnapshotV1, type PhotoSmartCollectionArchiveContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { assertPhotoSmartCollectionContextV1, readPhotoSmartCollectionPageOptionsV1, readPhotoSmartCollectionScopedKeyV1,
	readPhotoSmartCollectionSignalOptionsV1, PHOTO_SMART_COLLECTION_REPOSITORY_LIMITS_V1 as LIMITS,
	type AdmittedPhotoSmartCollectionPageOptionsV1, type PhotoSmartCollectionPageV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionSummaryV1, PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';

export interface AdmittedLightscaperNativeSmartCollectionPageCurrentV1 extends AdmittedPhotoSmartCollectionPageOptionsV1 { readonly catalogId: string }
export type AdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1 = ReturnType<typeof admitPhotoSmartCollectionSnapshotRequestV1>;
const pages = new WeakSet<AdmittedLightscaperNativeSmartCollectionPageCurrentV1>();
const snapshots = new WeakSet<AdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1>();
const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

/** The owner registers before borrowed capture, then queues this genuine
 * complete inert packet rather than recapturing mutable caller options. */
export function admitLightscaperNativeSmartCollectionPageCurrentV1(catalogId: unknown, options: unknown = {}): AdmittedLightscaperNativeSmartCollectionPageCurrentV1 {
	const catalog = id(catalogId, 'native saved page catalog'), admitted = readPhotoSmartCollectionPageOptionsV1(options, catalog);
	const value = Object.freeze({ catalogId: catalog, ...admitted }); pages.add(value); return value;
}
export function readLightscaperNativeSmartCollectionPageCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoSmartCollectionPageV1 {
	return readAdmittedLightscaperNativeSmartCollectionPageCurrentV1(database, admitLightscaperNativeSmartCollectionPageCurrentV1(catalogId, options));
}
export function readAdmittedLightscaperNativeSmartCollectionPageCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeSmartCollectionPageCurrentV1): PhotoSmartCollectionPageV1 {
	if (!pages.has(request)) throw new TypeError('Native saved pages require their genuine admitted request.');
	const { catalogId, continuation, signal } = request;
	return transaction(database, signal, () => {
		const context = captureLightscaperNativeSmartCollectionContextCurrentV1(database, catalogId, null);
		if (continuation !== null) assertPhotoSmartCollectionContextV1(context, continuation);
		const prefix = JSON.stringify([catalogId]).slice(0, -1) + ',', upper = prefix + '\uffff';
		const select = database.prepare(`SELECT ${COLUMNS} FROM native_photo_smart_collection_summaries WHERE collection_key>? AND collection_key<? ORDER BY collection_key LIMIT 1`);
		const items: Readonly<PhotoSmartCollectionSummaryV1>[] = []; let after = continuation?.afterKey ?? prefix, bytes = 2;
		while (items.length < LIMITS.maximumPageItems) {
			check(signal); const raw = select.get(after, upper); if (raw === undefined) break;
			const key = readPhotoSmartCollectionScopedKeyV1(raw.collection_key, catalogId);
			if (key <= after) throw new TypeError('Native saved page keys are not ordered.');
			const summary = readLightscaperNativeSmartCollectionSummaryRowCurrentV1(raw, catalogId, key);
			const definition = database.prepare('SELECT collection_key,catalog_id,collection_id FROM native_photo_smart_collections WHERE collection_key=?').get(key);
			if (!definition || definition.collection_key !== key || definition.catalog_id !== catalogId || definition.collection_id !== summary.id) throw new TypeError('Saved collection summary has an orphan or mismatched definition.');
			bytes += Buffer.byteLength(JSON.stringify(summary), 'utf8') + (items.length === 0 ? 0 : 1);
			if (bytes > LIMITS.maximumPageBytes) throw new RangeError('Saved collection summary page exceeds its byte budget.');
			items.push(summary); after = key;
		}
		const next = items.length === LIMITS.maximumPageItems ? Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-page', scope: 'smart-collections',
			catalogId, catalogRevision: context.root.revision, indexRevision: context.index.indexRevision, stateRevision: context.state.revision, afterKey: after }) : null;
		return Object.freeze({ items: Object.freeze(items), continuation: next === null ? null : readPhotoSmartCollectionPageOptionsV1({ continuation: next }, catalogId).continuation });
	});
}

export function admitLightscaperNativeSmartCollectionSnapshotCurrentV1(catalogId: unknown, selectedId: unknown,
	options: unknown = {}): AdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1 {
	const value = admitPhotoSmartCollectionSnapshotRequestV1(catalogId, selectedId, options); snapshots.add(value); return value;
}
export function readLightscaperNativeSmartCollectionSnapshotCurrentV1(database: DatabaseSync, catalogId: string, selectedId: string | null,
	options: unknown = {}): PhotoSmartCollectionSnapshotV1 {
	return readAdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1(database, admitLightscaperNativeSmartCollectionSnapshotCurrentV1(catalogId, selectedId, options));
}
export function readAdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1(database: DatabaseSync,
	request: AdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1): PhotoSmartCollectionSnapshotV1 {
	if (!snapshots.has(request)) throw new TypeError('Native saved snapshots require their genuine admitted request.');
	return transaction(database, request.signal, () => {
		const context = captureLightscaperNativeSmartCollectionContextCurrentV1(database, request.catalogId, request.selectedId);
		return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: request.selectedId, definition: context.definition,
			context: Object.freeze({ catalogId: request.catalogId, catalogRevision: context.root.revision, indexRevision: context.index.indexRevision,
				collectionStateRevision: context.state.revision, collectionCount: context.state.collectionCount }) });
	});
}
export function loadLightscaperNativeSmartCollectionCurrentV1(database: DatabaseSync, catalogId: string, collectionId: string,
	options: unknown = {}): Readonly<PhotoSmartCollectionV1> | null {
	return readLightscaperNativeSmartCollectionSnapshotCurrentV1(database, catalogId, collectionId, options).definition;
}
export function readLightscaperNativeSmartCollectionStateCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): Readonly<PhotoSmartCollectionsStateV1> {
	const catalog = id(catalogId, 'native saved state catalog'), admitted = readPhotoSmartCollectionSignalOptionsV1(options);
	return transaction(database, admitted.signal, () => captureLightscaperNativeSmartCollectionContextCurrentV1(database, catalog, null).state);
}
export function readLightscaperNativeSmartCollectionArchiveContextCurrentV1(database: DatabaseSync, catalogId: string, options: unknown = {}): PhotoSmartCollectionArchiveContextV1 {
	const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options);
	return transaction(database, admitted.signal, () => {
		const context = captureLightscaperNativeSmartCollectionContextCurrentV1(database, admitted.catalogId, null);
		return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: admitted.catalogId,
			catalogRevision: context.root.revision, indexRevision: context.index.indexRevision, state: context.persistedState });
	});
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }
function transaction<T>(database: DatabaseSync, signal: AbortSignal | undefined, run: () => T): T {
	check(signal); if (database.isTransaction) throw new Error('Native saved read requires its own serialized snapshot.'); database.exec('BEGIN');
	try { const value = run(); check(signal); database.exec('COMMIT'); return value; }
	catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error, cleanup], 'Native saved read and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
