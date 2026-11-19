/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPhotoSmartCollectionArchiveQueryV1, readPhotoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1, photoSmartCollectionRecordV1, readPhotoSmartCollectionRecordV1,
	type PhotoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionScopedKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1 as LIMITS, type PhotoSmartCollectionSummaryV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';

export const LIGHTSCAPER_NATIVE_SMART_COLLECTION_COLUMNS_CURRENT_V1 = 'collection_key,catalog_id,collection_id,revision,document,reference_keys';
export const LIGHTSCAPER_NATIVE_SMART_COLLECTION_SUMMARY_COLUMNS_CURRENT_V1 = 'collection_key,catalog_id,collection_id,revision,name';
export const LIGHTSCAPER_NATIVE_SMART_COLLECTION_STATE_COLUMNS_CURRENT_V1 = 'catalog_id,revision,collection_count';

/** Full stored authority includes the whole canonical reference projection.
 * The raw complete Query2 gate runs before normalized data may escape. */
export function readLightscaperNativeSmartCollectionRowCurrentV1(value: unknown, catalogId: string, expectedKey?: string): Readonly<PhotoSmartCollectionRecordV1> {
	const input = record(value, 'native saved definition', ['collection_key', 'catalog_id', 'collection_id', 'revision', 'document', 'reference_keys']);
	const catalog = id(catalogId, 'native saved catalog'), key = readPhotoSmartCollectionScopedKeyV1(field(input, 'collection_key'), catalog);
	if (expectedKey !== undefined && key !== expectedKey) throw new TypeError('Native saved definition has another lookup key.');
	const document: unknown = JSON.parse(boundedText(field(input, 'document'), LIMITS.maximumDocumentBytes, 'definition'));
	const referenceKeys: unknown = JSON.parse(boundedText(field(input, 'reference_keys'), PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumReferenceKeys * 288 + 2, 'references'));
	const raw = { key, catalogId: field(input, 'catalog_id'), referenceKeys, document };
	const definition = readPhotoSmartCollectionRecordV1(raw, catalog, key);
	assertPhotoSmartCollectionArchiveQueryV1(definition, raw);
	if (field(input, 'collection_id') !== definition.id || field(input, 'revision') !== definition.revision) throw new TypeError('Native saved definition disagrees with scalar identity.');
	return photoSmartCollectionRecordV1(definition);
}

export function readLightscaperNativeSmartCollectionSummaryRowCurrentV1(value: unknown, catalogId: string, expectedKey?: string): Readonly<PhotoSmartCollectionSummaryV1> {
	const input = record(value, 'native saved summary', ['collection_key', 'catalog_id', 'collection_id', 'revision', 'name']);
	const catalog = id(catalogId, 'native saved summary catalog'), key = readPhotoSmartCollectionScopedKeyV1(field(input, 'collection_key'), catalog);
	if (expectedKey !== undefined && key !== expectedKey) throw new TypeError('Native saved summary has another lookup key.');
	return readPhotoSmartCollectionSummaryRecordV1({ key, catalogId: field(input, 'catalog_id'), document: {
		schemaVersion: 1, kind: 'photo-smart-collection-summary', catalogId: field(input, 'catalog_id'), id: field(input, 'collection_id'),
		revision: field(input, 'revision'), name: readName(field(input, 'name')) } }, catalog, key);
}

export function readLightscaperNativeSmartCollectionStateRowCurrentV1(value: unknown, catalogId: string): Readonly<PhotoSmartCollectionsStateV1> {
	const input = record(value, 'native saved state', ['catalog_id', 'revision', 'collection_count']);
	const catalog = id(catalogId, 'native saved state catalog');
	if (field(input, 'catalog_id') !== catalog) throw new TypeError('Native saved state belongs to another catalog.');
	return normalizePhotoSmartCollectionsStateV1({ schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: catalog,
		revision: field(input, 'revision'), collectionCount: field(input, 'collection_count') });
}
function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string') throw new TypeError(`Native saved ${label} requires JSON text.`);
	if (value.length > maximum || Buffer.byteLength(value, 'utf8') > maximum) throw new RangeError(`Native saved ${label} exceeds its byte budget.`);
	return value;
}

/** SQLite TEXT receives escaped JSON, preserving every legal UTF16 name unit. */
function readName(value: unknown): string {
	const encoded = boundedText(value, 1538, 'summary name');
	const decoded: unknown = JSON.parse(encoded);
	if (typeof decoded !== 'string' || JSON.stringify(decoded) !== encoded) throw new TypeError('Native saved name requires its canonical JSON string codec.');
	return decoded;
}
