/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV1, photoQueryBuildProgressV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { PHOTO_QUERY_LIMITS_V1 as LIMITS } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';
import { readLightscaperNativeCatalogRowCurrentV1, readLightscaperNativePhotoRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1, writeLightscaperNativeLegacyQueryBuildCurrentV1,
	writeLightscaperNativeLegacyQueryPhotoCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';

const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const SOURCE_COLUMNS = 'photo_key,catalog_id,photo_id,revision,document,summary';

/** One joined Current source and Row1 per seek, at most16 and8MiB combined.
 * No Original/resource bytes or borrowed verifier callback enters SQLite. */
export function rebuildLightscaperNativeLegacyQueryIndexPageCurrentV1(database: DatabaseSync, catalogId: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): ReturnType<typeof photoQueryBuildProgressV1> {
	const catalog = id(catalogId, 'native legacy rebuild catalog'), input = record(options, 'native legacy rebuild options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const check = (): void => { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); }; check();
	if (database.isTransaction) throw new Error('Native legacy rebuild requires its own serialized transaction.');
	database.exec('BEGIN IMMEDIATE');
	try {
		check(); const rawRoot = database.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(catalog);
		if (rawRoot === undefined) throw new ReferenceError('Photo catalog is missing.');
		const { root } = readLightscaperNativeCatalogRowCurrentV1(rawRoot, catalog), build = getLightscaperNativeLegacyQueryBuildCurrentV1(database, catalog);
		if (!build) throw new ReferenceError('Native legacy build state is missing.');
		if (build.indexedCount > root.photoCount || build.ready && build.indexedCount !== root.photoCount) throw new TypeError('Legacy build count disagrees with its catalog.');
		if (build.afterKey !== null) {
			const anchor = database.prepare(`SELECT p.photo_key AS source_key,p.revision AS source_revision,q.photo_key AS query_key,q.photo_revision AS query_revision
				FROM native_photos p LEFT JOIN native_photo_query_rows_v1 q ON q.catalog_id=p.catalog_id AND q.photo_key=p.photo_key
				WHERE p.catalog_id=? AND p.photo_key=?`).get(catalog, build.afterKey);
			if (build.indexedCount < 1 || !anchor || anchor.source_key !== build.afterKey || anchor.query_key !== build.afterKey || anchor.source_revision !== anchor.query_revision) {
				throw new TypeError('Native legacy rebuild cursor coverage is missing or stale.');
			}
		}
		if (build.ready) { check(); database.exec('COMMIT'); return photoQueryBuildProgressV1(0,0,true); }
		const next = database.prepare(`SELECT ${SOURCE_COLUMNS} FROM native_photos WHERE catalog_id=? AND photo_key>? ORDER BY photo_key LIMIT 1`);
		let processed = 0, bytes = 0, afterKey = build.afterKey, exhausted = false;
		while (processed < LIMITS.rebuildPhotos) {
			check(); const raw = next.get(catalog, afterKey ?? `${catalog}|`);
			if (raw === undefined) { exhausted = true; break; }
			const photo = readLightscaperNativePhotoRowCurrentV1(raw, catalog), row = projectPhotoQueryRowV1(photo);
			const length = Buffer.byteLength(serializePhotoDocumentCurrentV1(photo), 'utf8') + Buffer.byteLength(JSON.stringify(row), 'utf8');
			if (bytes + length > LIMITS.rebuildBytes) break;
			writeLightscaperNativeLegacyQueryPhotoCurrentV1(database, photo, 'rebuild'); check(); processed++; bytes += length; afterKey = row.key;
		}
		check(); const latest = getLightscaperNativeLegacyQueryBuildCurrentV1(database, catalog);
		if (!latest || latest.ready || latest.afterKey !== build.afterKey || latest.indexedCount < build.indexedCount || latest.indexedCount > root.photoCount) {
			throw new TypeError('Native legacy build state changed inconsistently during its page.');
		}
		if (exhausted) {
			// Authenticate physical coverage once at exhaustion, never on every page.
			const count = database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v1 WHERE catalog_id=?').get(catalog)?.count;
			if (latest.indexedCount !== root.photoCount || count !== root.photoCount) throw new TypeError('Native legacy final physical row count cannot claim readiness.');
		}
		writeLightscaperNativeLegacyQueryBuildCurrentV1(database, { ...latest, ready: exhausted, afterKey }); check();
		const progress = photoQueryBuildProgressV1(processed,bytes,exhausted); database.exec('COMMIT'); return progress;
	} catch (error) {
		try { if (database.isTransaction) database.exec('ROLLBACK'); }
		catch (cleanup) { throw new AggregateError([error,cleanup], 'Native legacy rebuild and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}
