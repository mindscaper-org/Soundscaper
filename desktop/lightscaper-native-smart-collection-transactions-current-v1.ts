/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readValidatedPhotoCatalogRootV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoSmartCollectionRecordV1, photoSmartCollectionKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { validatePhotoSmartCollectionReferencesV1 } from '../src/lightscaper/catalog/photo-smart-collection-references-v1.ts';
import { assertPhotoSmartCollectionContextV1, PhotoSmartCollectionRevisionConflictError, smartCollectionRevisionV1,
	type PhotoSmartCollectionWriteReceiptV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, normalizePhotoSmartCollectionV1, serializePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 as capture,
	type LightscaperNativeSmartCollectionContextCurrentV1 } from './lightscaper-native-smart-collection-context-current-v1.ts';
import { prepareLightscaperNativeSmartCollectionWriteGuardCurrentV1 as prepareGuard,
	assertLightscaperNativeSmartCollectionWriteGuardCurrentV1 as assertGuard } from './lightscaper-native-smart-collection-audit-current-v1.ts';
import { admitLightscaperNativeSmartCollectionSaveCurrentV1 as admitSave, admitLightscaperNativeSmartCollectionDeleteCurrentV1 as admitDelete,
	readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1, type AdmittedLightscaperNativeSmartCollectionWriteCurrentV1 } from './lightscaper-native-smart-collection-admission-current-v1.ts';
import { assertLightscaperNativeSmartCollectionNotAbortedCurrentV1 as notAborted,
	withLightscaperNativeSmartCollectionTransactionCurrentV1 as transaction } from './lightscaper-native-smart-collection-transaction-current-v1.ts';

export { admitLightscaperNativeSmartCollectionSaveCurrentV1, admitLightscaperNativeSmartCollectionDeleteCurrentV1,
	type AdmittedLightscaperNativeSmartCollectionSaveCurrentV1, type AdmittedLightscaperNativeSmartCollectionDeleteCurrentV1 } from './lightscaper-native-smart-collection-admission-current-v1.ts';

export async function saveLightscaperNativeSmartCollectionCurrentV1(database: DatabaseSync, value: unknown,
	expected: unknown, options: unknown): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	return saveAdmittedLightscaperNativeSmartCollectionCurrentV1(database, admitSave(value, expected, options));
}
export async function deleteLightscaperNativeSmartCollectionCurrentV1(database: DatabaseSync, catalogId: unknown, collectionId: unknown,
	expected: unknown, options: unknown): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	return deleteAdmittedLightscaperNativeSmartCollectionCurrentV1(database, admitDelete(catalogId, collectionId, expected, options));
}
export async function saveAdmittedLightscaperNativeSmartCollectionCurrentV1(database: DatabaseSync, value: unknown,
	signal?: AbortSignal): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	const packet = readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1(value);
	if (packet.kind !== 'save') throw new TypeError('A saved collection save requires its owning admitted save packet.');
	return write(database, packet, signal ?? packet.options.signal);
}
export async function deleteAdmittedLightscaperNativeSmartCollectionCurrentV1(database: DatabaseSync, value: unknown,
	signal?: AbortSignal): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	const packet = readAdmittedLightscaperNativeSmartCollectionWriteCurrentV1(value);
	if (packet.kind !== 'delete') throw new TypeError('A saved collection delete requires its owning admitted delete packet.');
	return write(database, packet, signal ?? packet.options.signal);
}

async function write(database: DatabaseSync, packet: AdmittedLightscaperNativeSmartCollectionWriteCurrentV1,
	signal: AbortSignal | undefined): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const captured = transaction(database, 'read', signal, () => {
		const context = capture(database, packet.catalogId, null);
		assertPhotoSmartCollectionContextV1(context, packet.options);
		if (packet.candidate !== null) validatePhotoSmartCollectionReferencesV1(packet.candidate, context.root);
		return context;
	});
	// The one captured root and detached candidate remain live, and are charged
	// throughout every bounded page. No projection is retained until final SQL.
	const guard = await prepareGuard(database, packet, captured.root, signal);
	return transaction(database, 'write', signal, () => {
		const context = capture(database, packet.catalogId, packet.collectionId);
		assertPhotoSmartCollectionContextV1(context, packet.options);
		assertGuard(guard, database, context, packet);
		const previous = context.definition;
		if (packet.expected === null ? previous !== null : previous === null || previous.revision !== packet.expected) throw new PhotoSmartCollectionRevisionConflictError();
		if (packet.candidate !== null) validatePhotoSmartCollectionReferencesV1(packet.candidate, context.root);
		const next = packet.candidate === null ? null : normalizePhotoSmartCollectionV1({ ...packet.candidate, revision: previous === null ? 0 : increment(previous.revision) });
		const delta = next === null ? -1 : previous === null ? 1 : 0;
		const state = normalizePhotoSmartCollectionsStateV1({ ...context.state, revision: increment(context.state.revision), collectionCount: context.state.collectionCount + delta });
		if (context.root.collections.length + state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) throw new RangeError('Combined collection count exceeds its 10000 collection budget.');
		const root = readValidatedPhotoCatalogRootV1({ ...context.root, revision: increment(context.root.revision) });
		const index = indexState(root, increment(context.index.indexRevision));
		const row = next === null ? null : photoSmartCollectionRecordV1(next), summary = next === null ? null : photoSmartCollectionSummaryRecordV1(next);
		const document = next === null ? null : serializePhotoSmartCollectionV1(next), references = row === null ? null : JSON.stringify(row.referenceKeys);
		const rootDocument = serializeLightscaperDocumentV1(root), name = summary === null ? null : JSON.stringify(summary.document.name);
		const receipt = Object.freeze({ schemaVersion: 1 as const, kind: 'photo-smart-collection-write' as const, catalogId: packet.catalogId,
			catalogRevision: root.revision, indexRevision: index.indexRevision, state, definition: next });
		// Every increment, bounded projection, recipe and UTF16-safe scalar codec
		// is admitted before the first mutation. All three epochs remain SQL CAS.
		notAborted(signal);
		const key = photoSmartCollectionKeyV1(packet.catalogId, packet.collectionId);
		if (next === null) {
			changed(database.prepare('DELETE FROM native_photo_smart_collections WHERE collection_key=? AND catalog_id=? AND revision=?').run(key, packet.catalogId, packet.expected));
			changed(database.prepare('DELETE FROM native_photo_smart_collection_summaries WHERE collection_key=? AND catalog_id=? AND revision=?').run(key, packet.catalogId, packet.expected));
		} else if (previous === null) {
			database.prepare('INSERT INTO native_photo_smart_collections(collection_key,catalog_id,collection_id,revision,document,reference_keys) VALUES(?,?,?,?,?,?)')
				.run(key, packet.catalogId, next.id, next.revision, document, references);
			database.prepare('INSERT INTO native_photo_smart_collection_summaries(collection_key,catalog_id,collection_id,revision,name) VALUES(?,?,?,?,?)')
				.run(key, packet.catalogId, next.id, next.revision, name);
		} else {
			changed(database.prepare('UPDATE native_photo_smart_collections SET revision=?,document=?,reference_keys=? WHERE collection_key=? AND catalog_id=? AND revision=?')
				.run(next.revision, document, references, key, packet.catalogId, previous.revision));
			changed(database.prepare('UPDATE native_photo_smart_collection_summaries SET revision=?,name=? WHERE collection_key=? AND catalog_id=? AND revision=?')
				.run(next.revision, name, key, packet.catalogId, previous.revision));
		}
		changed(database.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=?,index_revision=? WHERE id=? AND root_revision=? AND index_revision=?')
			.run(rootDocument, root.revision, index.indexRevision, root.id, context.root.revision, context.index.indexRevision));
		writeState(database, context, state.revision, state.collectionCount);
		return receipt;
	});
}
function writeState(database: DatabaseSync, context: LightscaperNativeSmartCollectionContextCurrentV1, revision: number, count: number): void {
	if (context.persistedState === null) database.prepare('INSERT INTO native_photo_smart_collection_states(catalog_id,revision,collection_count) VALUES(?,?,?)').run(context.root.id, revision, count);
	else changed(database.prepare('UPDATE native_photo_smart_collection_states SET revision=?,collection_count=? WHERE catalog_id=? AND revision=? AND collection_count=?')
		.run(revision, count, context.root.id, context.persistedState.revision, context.persistedState.collectionCount));
}
function increment(value: number): number { return smartCollectionRevisionV1(value + 1); }
function changed(result: { readonly changes: number | bigint }): void {
	if (result.changes !== 1) throw new PhotoSmartCollectionRevisionConflictError();
}
