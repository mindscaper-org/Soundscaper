/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readLightscaperNativeCatalogRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { LIGHTSCAPER_NATIVE_SMART_COLLECTION_COLUMNS_CURRENT_V1 as COLUMNS,
	LIGHTSCAPER_NATIVE_SMART_COLLECTION_SUMMARY_COLUMNS_CURRENT_V1 as SUMMARY_COLUMNS,
	LIGHTSCAPER_NATIVE_SMART_COLLECTION_STATE_COLUMNS_CURRENT_V1 as STATE_COLUMNS,
	readLightscaperNativeSmartCollectionRowCurrentV1, readLightscaperNativeSmartCollectionSummaryRowCurrentV1,
	readLightscaperNativeSmartCollectionStateRowCurrentV1 } from './lightscaper-native-smart-collection-records-current-v1.ts';
import { photoSmartCollectionKeyV1, type PhotoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionScopedKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { validatePhotoSmartCollectionReferencesV1 } from '../src/lightscaper/catalog/photo-smart-collection-references-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, type PhotoSmartCollectionV1, type PhotoSmartCollectionSummaryV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionStorageContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

export interface LightscaperNativeSmartCollectionPairCurrentV1 {
	readonly definition: Readonly<PhotoSmartCollectionV1>;
	readonly record: Readonly<PhotoSmartCollectionRecordV1>;
	readonly summary: Readonly<PhotoSmartCollectionSummaryV1>;
}
export interface LightscaperNativeSmartCollectionContextCurrentV1 extends PhotoSmartCollectionStorageContextV1 {
	readonly persistedState: Readonly<PhotoSmartCollectionsStateV1> | null;
	readonly definition: Readonly<PhotoSmartCollectionV1> | null;
	readonly record: Readonly<PhotoSmartCollectionRecordV1> | null;
	readonly summary: Readonly<PhotoSmartCollectionSummaryV1> | null;
}

/** Point context only: full inventory/count authority belongs to the bounded
 * audit owner. Four scalar first-key guards cover primary and scoped paths;
 * no Query1/2 readiness or complete recipe inventory is consulted. */
export function captureLightscaperNativeSmartCollectionContextCurrentV1(database: DatabaseSync, catalogId: string,
	selectedId: string | null): Readonly<LightscaperNativeSmartCollectionContextCurrentV1> {
	requireTransaction(database); const catalog = id(catalogId, 'native saved catalog');
	const selected = selectedId === null ? null : id(selectedId, 'native saved selection');
	const raw = database.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(catalog);
	if (raw === undefined) throw new ReferenceError('Photo catalog is missing.');
	const { root, index } = readLightscaperNativeCatalogRowCurrentV1(raw, catalog);
	const stateRaw = database.prepare(`SELECT ${STATE_COLUMNS} FROM native_photo_smart_collection_states WHERE catalog_id=?`).get(catalog);
	const persistedState = stateRaw === undefined ? null : readLightscaperNativeSmartCollectionStateRowCurrentV1(stateRaw, catalog);
	const state = persistedState ?? normalizePhotoSmartCollectionsStateV1({ schemaVersion: 1, kind: 'photo-smart-collections-state',
		catalogId: catalog, revision: 0, collectionCount: 0 });
	if (root.collections.length + state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) throw new RangeError('Combined catalog collection count exceeds its budget.');
	const definition = first(database, 'native_photo_smart_collections', catalog, false), definitionScoped = first(database, 'native_photo_smart_collections', catalog, true);
	const summary = first(database, 'native_photo_smart_collection_summaries', catalog, false), summaryScoped = first(database, 'native_photo_smart_collection_summaries', catalog, true);
	if (state.collectionCount === 0) {
		if (definition !== null || definitionScoped !== null || summary !== null || summaryScoped !== null) throw new TypeError('Empty or missing saved state has retained rows.');
	} else if (definition === null || definitionScoped === null || summary === null || summaryScoped === null
		|| definition !== definitionScoped || definition !== summary || definition !== summaryScoped) {
		throw new TypeError('Positive saved state has missing or unpaired first keys.');
	}
	const pair = selected === null ? null : readLightscaperNativeSmartCollectionPairCurrentV1(database, catalog, photoSmartCollectionKeyV1(catalog, selected), root);
	return Object.freeze({ root, index, state, persistedState, definition: pair?.definition ?? null, record: pair?.record ?? null, summary: pair?.summary ?? null });
}

/** True absence requires both sides absent. A selected pair always admits the
 * complete stored reference projection and exact scalar summary together. */
export function readLightscaperNativeSmartCollectionPairCurrentV1(database: DatabaseSync, catalogId: string,
	collectionKey: string, root?: Readonly<PhotoCatalogRootV1>): Readonly<LightscaperNativeSmartCollectionPairCurrentV1> | null {
	requireTransaction(database); const catalog = id(catalogId, 'native saved pair catalog'), key = readPhotoSmartCollectionScopedKeyV1(collectionKey, catalog);
	const raw = database.prepare(`SELECT ${COLUMNS} FROM native_photo_smart_collections WHERE collection_key=?`).get(key);
	const rawSummary = database.prepare(`SELECT ${SUMMARY_COLUMNS} FROM native_photo_smart_collection_summaries WHERE collection_key=?`).get(key);
	if (raw === undefined && rawSummary === undefined) return null;
	if (raw === undefined || rawSummary === undefined) throw new TypeError('Saved collection has an orphan definition or missing summary.');
	const record = readLightscaperNativeSmartCollectionRowCurrentV1(raw, catalog, key), definition = record.document;
	const summary = readLightscaperNativeSmartCollectionSummaryRowCurrentV1(rawSummary, catalog, key);
	if (summary.name !== definition.name || summary.revision !== definition.revision) throw new TypeError('Saved summary disagrees with its selected definition.');
	if (root !== undefined) {
		if (root.id !== catalog) throw new TypeError('Saved references require their own catalog root.');
		validatePhotoSmartCollectionReferencesV1(definition, root);
	}
	return Object.freeze({ definition, record, summary });
}
function first(database: DatabaseSync, table: 'native_photo_smart_collections' | 'native_photo_smart_collection_summaries', catalog: string, scoped: boolean): string | null {
	const prefix = JSON.stringify([catalog]).slice(0, -1) + ',';
	const raw = database.prepare(`SELECT collection_key,catalog_id,collection_id FROM ${table}
		WHERE ${scoped ? 'catalog_id=?' : 'collection_key>=? AND collection_key<?'} ORDER BY collection_key LIMIT 1`)
		.get(...(scoped ? [catalog] : [prefix, prefix + '\uffff']));
	if (raw === undefined) return null;
	const input = record(raw, 'native saved first key', ['collection_key', 'catalog_id', 'collection_id']);
	const key = readPhotoSmartCollectionScopedKeyV1(field(input, 'collection_key'), catalog);
	if (field(input, 'catalog_id') !== catalog || key !== photoSmartCollectionKeyV1(catalog, id(field(input, 'collection_id'), 'native saved first ID'))) throw new TypeError('Native saved first key disagrees with its catalog scope.');
	return key;
}
function requireTransaction(database: DatabaseSync): void { if (!database.isTransaction) throw new Error('Native saved context requires one caller snapshot.'); }
