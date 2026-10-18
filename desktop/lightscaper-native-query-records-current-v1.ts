/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_QUERY_ROW_LIMITS_V2, readPhotoQueryRowV2, type PhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoQueryBuildStateV2 } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';

/** SQLite BLOB order equals IndexedDB string order only when each JavaScript
 * UTF-16 code unit is encoded big-endian, including unpaired surrogates. The
 * shared projector already lowercases names; this encoder preserves its input. */
export function lightscaperNativeQueryFileNameKeyCurrentV1(value: string): Uint8Array {
	if (typeof value !== 'string' || value.length > 1024) throw new RangeError('Native query filename sort key exceeds its profile.');
	const result = new Uint8Array(value.length * 2);
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index); result[index * 2] = unit >>> 8; result[index * 2 + 1] = unit & 255;
	}
	return result;
}

/** No source Photo/Develop aggregate is selected by query pages. Each actual
 * native scalar and index key must agree with its bounded shared projection. */
export function readLightscaperNativeQueryRowCurrentV1(value: unknown): PhotoQueryRowV2 {
	const input = record(value, 'native query2 row', ['photo_key', 'catalog_id', 'photo_id', 'photo_revision', 'row_json',
		'file_name_key', 'capture_bucket', 'capture_sort', 'rating_sort']);
	const text = field(input, 'row_json');
	if (typeof text !== 'string') throw new TypeError('Native query2 row requires JSON text.');
	if (text.length > PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes || Buffer.byteLength(text, 'utf8') > PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes) {
		throw new RangeError('Native query2 row exceeds its byte budget.');
	}
	const parsed: unknown = JSON.parse(text), row = readPhotoQueryRowV2(parsed);
	const bytes = field(input, 'file_name_key'), expected = lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort);
	if (field(input, 'photo_key') !== row.key || field(input, 'catalog_id') !== row.catalogId || field(input, 'photo_id') !== row.photoId
		|| field(input, 'photo_revision') !== row.photoRevision || field(input, 'capture_bucket') !== row.captureBucket
		|| field(input, 'capture_sort') !== row.captureSort || field(input, 'rating_sort') !== row.ratingSort
		|| !(bytes instanceof Uint8Array) || bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index])) {
		throw new TypeError('Native query2 row disagrees with its scalar identity or index keys.');
	}
	return row;
}

/** This native bridge imports the shared state type only; importing browser
 * storage at runtime would pull IndexedDB into the desktop database owner. */
export function readLightscaperNativeQueryBuildCurrentV1(value: unknown, expectedCatalogId: string): PhotoQueryBuildStateV2 {
	const input = record(value, 'native query2 build', ['catalog_id', 'ready', 'after_key', 'indexed_count']);
	const catalogId = id(field(input, 'catalog_id'), 'native query2 catalog');
	if (catalogId !== id(expectedCatalogId, 'requested native query2 catalog')) throw new TypeError('Native query2 build belongs to another catalog.');
	const ready = field(input, 'ready'), afterKey = field(input, 'after_key');
	if (ready !== 0 && ready !== 1) throw new TypeError('Native query2 readiness requires zero or one.');
	if (afterKey !== null) {
		if (typeof afterKey !== 'string' || !afterKey.startsWith(`${catalogId}|`)) throw new TypeError('Native query2 cursor belongs to another catalog.');
		id(afterKey.slice(catalogId.length + 1), 'native query2 cursor Photo');
	}
	return Object.freeze({ id: catalogId, schemaVersion: 2, ready: ready === 1, afterKey,
		indexedCount: integer(field(input, 'indexed_count'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'native query2 indexed count') });
}
