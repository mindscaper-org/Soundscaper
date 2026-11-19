/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { serializeLightscaperDocumentV1 } from '../../src/lightscaper/catalog/documents.ts';
import { photoSmartCollectionKeyV1, photoSmartCollectionRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { normalizePhotoSmartCollectionV1, type PhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { nativeCatalogRootCurrentV1 } from './lightscaper-native-catalog-fixture-current.ts';

export function nativeSmartCollectionDefinitionFixtureCurrentV1(index = 0, catalogId = 'catalog') {
	return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId,
		id: `saved-${String(index).padStart(5, '0')}`, name: `Saved ${String(index)}`, revision: 2,
		query: { schemaVersion: 2, kind: 'photo-catalog-query', filter: { kind: 'folder', id: 'folder' },
			predicate: { kind: 'not', term: { kind: 'keyword', id: 'keyword' } } } });
}
export function insertNativeSmartCollectionFixtureCurrentV1(database: DatabaseSync, definition: PhotoSmartCollectionV1): void {
	const record = photoSmartCollectionRecordV1(definition);
	database.prepare('INSERT INTO native_photo_smart_collections VALUES (?,?,?,?,?,?)').run(record.key, definition.catalogId, definition.id,
		definition.revision, JSON.stringify(definition), JSON.stringify(record.referenceKeys));
	database.prepare('INSERT INTO native_photo_smart_collection_summaries VALUES (?,?,?,?,?)').run(record.key, definition.catalogId, definition.id,
		definition.revision, JSON.stringify(definition.name));
}
export function seedNativeSmartCollectionFixtureCurrentV1(database: DatabaseSync, count = 0, stateRevision: number | null = count === 0 ? null : 7) {
	const root = { ...nativeCatalogRootCurrentV1(), revision: 3 };
	database.prepare('INSERT INTO native_photo_catalogs VALUES (?,?,?,?,?)').run(root.id, serializeLightscaperDocumentV1(root), root.revision, root.photoCount, 11);
	const definitions = Array.from({ length: count }, (_, index) => nativeSmartCollectionDefinitionFixtureCurrentV1(index));
	for (const definition of definitions) insertNativeSmartCollectionFixtureCurrentV1(database, definition);
	if (stateRevision !== null) database.prepare('INSERT INTO native_photo_smart_collection_states VALUES (?,?,?)').run(root.id, stateRevision, count);
	return { root, definitions, key: (index: number) => photoSmartCollectionKeyV1(root.id, definitions[index]!.id) };
}
