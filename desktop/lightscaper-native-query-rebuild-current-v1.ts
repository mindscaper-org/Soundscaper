/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { serializePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoQueryBuildProgressV2 } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { PHOTO_QUERY_LIMITS_V2 as LIMITS } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';
import { readLightscaperNativeCatalogRowCurrentV1, readLightscaperNativePhotoRowCurrentV1 } from './lightscaper-native-catalog-database-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1, writeLightscaperNativeQueryBuildCurrentV1,
	writeLightscaperNativeQueryPhotoCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { withProjectLibraryImmediateTransaction } from './project-library-immediate-transaction.ts';

const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const SOURCE_COLUMNS = 'photo_key, catalog_id, photo_id, revision, document, summary';

/** Root queues this synchronous operation after capturing its request. No
 * borrowed body/resource/verifier callback runs inside its immediate SQLite
 * transaction. A completed return remains acknowledged after later abort. */
export function rebuildLightscaperNativeQueryIndexPageCurrentV1(database: DatabaseSync, catalogId: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): PhotoQueryBuildProgressV2 {
	const catalog = id(catalogId, 'native query2 rebuild catalog');
	const input = record(options, 'native query2 rebuild options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const check = (): void => { if (signal !== undefined) Reflect.apply(nativeThrowIfAborted, signal, []); };
	check();
	return withProjectLibraryImmediateTransaction(database, () => {
		check();
		const rawRoot = database.prepare('SELECT id, document, root_revision, photo_count, index_revision FROM native_photo_catalogs WHERE id = ?').get(catalog);
		if (rawRoot === undefined) throw new ReferenceError('Photo catalog is missing.');
		const { root } = readLightscaperNativeCatalogRowCurrentV1(rawRoot, catalog);
		const build = getLightscaperNativeQueryBuildCurrentV1(database, catalog);
		if (!build) throw new ReferenceError('Native Query2 build state is missing.');
		if (build.indexedCount > root.photoCount || (build.ready && build.indexedCount !== root.photoCount)) throw new TypeError('Query2 build count disagrees with its catalog.');
		if (build.afterKey !== null) {
			const anchor = database.prepare(`SELECT p.photo_key AS source_key, p.revision AS source_revision,
				q.photo_key AS query_key, q.photo_revision AS query_revision FROM native_photos p
				LEFT JOIN native_photo_query_rows_v2 q ON q.catalog_id = p.catalog_id AND q.photo_key = p.photo_key
				WHERE p.catalog_id = ? AND p.photo_key = ?`).get(catalog, build.afterKey);
			if (build.indexedCount < 1 || !anchor || anchor.source_key !== build.afterKey || anchor.query_key !== build.afterKey
				|| anchor.source_revision !== anchor.query_revision) throw new TypeError('Native Query2 cursor coverage is missing or stale.');
		}
		if (build.ready) { check(); return progress(0, 0, 0, true); }
		const nextSource = database.prepare(`SELECT ${SOURCE_COLUMNS} FROM native_photos
			WHERE catalog_id = ? AND photo_key > ? ORDER BY photo_key LIMIT 1`);
		let processed = 0, bytes = 0, derivedBytes = 0, afterKey = build.afterKey, exhausted = false;
		while (processed < LIMITS.rebuildPhotos) {
			check();
			const raw = nextSource.get(catalog, afterKey ?? `${catalog}|`);
			if (raw === undefined) { exhausted = true; break; }
			const photo = readLightscaperNativePhotoRowCurrentV1(raw, catalog);
			const sourceBytes = Buffer.byteLength(serializePhotoDocumentCurrentV1(photo), 'utf8');
			const row = projectPhotoQueryRowV2(photo), rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
			if (bytes + derivedBytes + sourceBytes + rowBytes > LIMITS.rebuildBytes) break;
			writeLightscaperNativeQueryPhotoCurrentV1(database, photo, 'rebuild');
			check(); processed++; bytes += sourceBytes; derivedBytes += rowBytes; afterKey = row.key;
		}
		check();
		const latest = getLightscaperNativeQueryBuildCurrentV1(database, catalog);
		if (!latest || latest.ready || latest.afterKey !== build.afterKey || latest.indexedCount < build.indexedCount
			|| latest.indexedCount > root.photoCount) throw new TypeError('Native Query2 build state changed inconsistently during its page.');
		if (exhausted) {
			// Ordinary pages trust the count maintained with each actual row write.
			// Exactly once at successful exhaustion, authenticate physical count.
			// Counting here is O(N) total; doing it every page would be O(N²).
			const count = database.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v2 WHERE catalog_id = ?').get(catalog)?.count;
			if (latest.indexedCount !== root.photoCount || count !== root.photoCount) throw new TypeError('Query2 final physical row count disagrees; coverage cannot claim readiness.');
		}
		writeLightscaperNativeQueryBuildCurrentV1(database, { ...latest, ready: exhausted, afterKey });
		check();
		return progress(processed, bytes, derivedBytes, exhausted);
	});
}

/** Same shared limits/receipt profile without importing the browser IDB writer. */
function progress(processed: number, bytes: number, derivedBytes: number, ready: boolean): PhotoQueryBuildProgressV2 {
	const source = integer(bytes, 0, LIMITS.rebuildBytes, 'query2 rebuilt source bytes');
	const derived = integer(derivedBytes, 0, LIMITS.rebuildBytes, 'query2 rebuilt derived bytes');
	if (source + derived > LIMITS.rebuildBytes) throw new RangeError('Photo query2 rebuild exceeds its combined byte budget.');
	return Object.freeze({ processed: integer(processed, 0, LIMITS.rebuildPhotos, 'query2 rebuilt photos'), bytes: source, derivedBytes: derived, ready });
}
