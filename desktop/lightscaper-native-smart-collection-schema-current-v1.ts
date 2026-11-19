/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';

const stable = (column: string) => `length(${column}) BETWEEN 1 AND 128 AND ${column} GLOB '[A-Za-z0-9]*' AND ${column} NOT GLOB '*[^A-Za-z0-9._:-]*'`;

/** Independent paired records and retained state. Migration/open/create never
 * materialize a saved state; physical absence is separate archive authority. */
export const LIGHTSCAPER_NATIVE_SMART_COLLECTION_SCHEMA_CURRENT_V1 = Object.freeze([
	{ type: 'table', name: 'native_photo_smart_collections', sql: `CREATE TABLE native_photo_smart_collections (
	collection_key TEXT PRIMARY KEY NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	collection_id TEXT NOT NULL CHECK (${stable('collection_id')}),
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
	document TEXT NOT NULL CHECK (length(CAST(document AS BLOB)) BETWEEN 1 AND ${PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes}),
	reference_keys TEXT NOT NULL CHECK (length(CAST(reference_keys AS BLOB)) BETWEEN 2 AND ${PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumReferenceKeys * 288 + 2}),
	CHECK (collection_key = json_array(catalog_id, collection_id))
) STRICT` },
	{ type: 'table', name: 'native_photo_smart_collection_summaries', sql: `CREATE TABLE native_photo_smart_collection_summaries (
	collection_key TEXT PRIMARY KEY NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	collection_id TEXT NOT NULL CHECK (${stable('collection_id')}),
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
	name TEXT NOT NULL CHECK (length(CAST(name AS BLOB)) BETWEEN 3 AND 1538),
	CHECK (collection_key = json_array(catalog_id, collection_id))
) STRICT` },
	{ type: 'table', name: 'native_photo_smart_collection_states', sql: `CREATE TABLE native_photo_smart_collection_states (
	catalog_id TEXT PRIMARY KEY NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
	collection_count INTEGER NOT NULL CHECK (collection_count BETWEEN 0 AND ${PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections})
) STRICT` },
	{ type: 'index', name: 'native_photo_smart_collections_catalog_key', sql: 'CREATE INDEX native_photo_smart_collections_catalog_key ON native_photo_smart_collections(catalog_id, collection_key)' },
	{ type: 'index', name: 'native_photo_smart_collection_summaries_catalog_key', sql: 'CREATE INDEX native_photo_smart_collection_summaries_catalog_key ON native_photo_smart_collection_summaries(catalog_id, collection_key)' },
]);
