/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_WRITER_APPLICATION_ID_CURRENT_V1 = 0x4c534c57;
export const LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_WRITER_SCHEMA_CURRENT_V1 = 'CREATE TABLE native_photo_library_writer_guard (singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1)) STRICT';

/** The file records format ownership only. The actual live SQLite transaction,
 * rather than a PID, TTL or persisted row, supplies writer exclusion. */
export function inspectLightscaperNativePhotoLibraryWriterDatabaseCurrentV1(database: DatabaseSync): 'empty' | 'owned' {
	const application = database.prepare('PRAGMA application_id').get()?.application_id;
	const version = database.prepare('PRAGMA user_version').get()?.user_version;
	const objects = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
	if (application === 0 && version === 0 && objects.length === 0) return 'empty';
	const table = objects[0];
	if (application !== LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_WRITER_APPLICATION_ID_CURRENT_V1 || version !== 1
		|| objects.length !== 1 || !table || table.type !== 'table' || table.name !== 'native_photo_library_writer_guard'
		|| table.tbl_name !== table.name || table.sql !== LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_WRITER_SCHEMA_CURRENT_V1
		|| database.prepare('SELECT 1 FROM native_photo_library_writer_guard LIMIT 1').get() !== undefined) {
		throw new Error('Native Photo library writer guard has an unowned identity, schema or retained row.');
	}
	return 'owned';
}

export function initializeLightscaperNativePhotoLibraryWriterDatabaseCurrentV1(database: DatabaseSync): void {
	if (database.isTransaction) throw new Error('Native Photo writer initialization requires an idle connection.');
	if (inspectLightscaperNativePhotoLibraryWriterDatabaseCurrentV1(database) === 'owned') return;
	database.exec('BEGIN IMMEDIATE');
	try {
		// Another valid creator may have won between inspection and acquisition.
		if (inspectLightscaperNativePhotoLibraryWriterDatabaseCurrentV1(database) === 'empty') {
			database.exec(LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_WRITER_SCHEMA_CURRENT_V1);
			database.exec(`PRAGMA application_id=${LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_WRITER_APPLICATION_ID_CURRENT_V1}; PRAGMA user_version=1`);
		}
		if (inspectLightscaperNativePhotoLibraryWriterDatabaseCurrentV1(database) !== 'owned') throw new Error('Native Photo writer format initialization did not settle.');
		database.exec('COMMIT');
	} catch (primary) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native writer schema initialization and rollback failed.', { cause: cleanup }); }
		throw primary;
	}
}
