/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { initializeLightscaperNativeCatalogDatabaseCurrentV1, inspectLightscaperNativeCatalogDatabaseCurrentV1 } from './lightscaper-native-catalog-database-current-v1.ts';
import { openLightscaperNativePhotoLibraryDatabaseCurrentV1 } from './lightscaper-native-photo-library-files-current-v1.ts';

/** Read-only exact ownership admission precedes writable recovery or chmod.
 * Existing migrations keep their original schema and bounded rebuild work. */
export function openLightscaperNativeCatalogDatabaseCurrentV1(appDataPath: string): Promise<DatabaseSync> {
	return openLightscaperNativePhotoLibraryDatabaseCurrentV1(appDataPath, { fileName: 'native-photo-catalogs.sqlite3',
		inspect: inspectLightscaperNativeCatalogDatabaseCurrentV1, initialize: initializeLightscaperNativeCatalogDatabaseCurrentV1 });
}
