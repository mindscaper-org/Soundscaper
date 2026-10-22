/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { legacyQueryFixtureCurrentV1, seedNativeLegacyQueryCurrentV1, type NativeLegacyQuerySeedOptionsCurrentV1 } from './lightscaper-native-legacy-query-fixture-current.ts';
import { insertNativeSmartCollectionFixtureCurrentV1 } from './lightscaper-native-smart-collection-fixture-current.ts';
import { normalizePhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoCatalogQueryV2, type PhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';

export { CATALOG, key, photoId, legacyQueryCurrentV1 as queryV1 } from './lightscaper-native-legacy-query-fixture-current.ts';
export { stackQueryCurrentV1 as queryV2 } from './lightscaper-native-stack-query-fixture-current.ts';
export const nativeCullingFixtureCurrentV1 = legacyQueryFixtureCurrentV1;
export interface NativeCullingSeedOptionsCurrentV1 extends NativeLegacyQuerySeedOptionsCurrentV1 { readonly savedQuery?: PhotoCatalogQueryV2 }
export function seedNativeCullingCurrentV1(database: DatabaseSync, count = 130, options: NativeCullingSeedOptionsCurrentV1 = {}) {
	const f = seedNativeLegacyQueryCurrentV1(database, count, options), savedDefinition = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection',
		catalogId: 'catalog', id: 'saved', revision: 2, name: 'Saved native culling', query: options.savedQuery ?? normalizePhotoCatalogQueryV2() });
	insertNativeSmartCollectionFixtureCurrentV1(database, savedDefinition);
	database.prepare('INSERT INTO native_photo_smart_collection_states(catalog_id,revision,collection_count) VALUES(?,7,1)').run('catalog');
	return { ...f, rowsV1: f.legacyRows, rowsV2: f.rows, savedDefinition };
}
