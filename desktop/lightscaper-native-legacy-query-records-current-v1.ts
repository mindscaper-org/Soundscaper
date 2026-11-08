/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoQueryBuildStateV1, readPhotoQueryRowV1, type PhotoQueryBuildStateV1, type PhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { PHOTO_QUERY_LIMITS_V1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { field, id, record } from '../src/lightscaper/catalog/value-validation.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';

/** Legacy Row1 owns its complete summary and metadata projection. Native scalar
 * identity and sort keys must agree without reading a source Photo aggregate. */
export function readLightscaperNativeLegacyQueryRowCurrentV1(value: unknown): PhotoQueryRowV1 {
	const input = record(value, 'native query1 row', ['photo_key', 'catalog_id', 'photo_id', 'photo_revision', 'row_json',
		'file_name_key', 'capture_bucket', 'capture_sort', 'rating_sort']);
	const text = field(input, 'row_json');
	if (typeof text !== 'string') throw new TypeError('Native query1 row requires JSON text.');
	if (text.length > PHOTO_QUERY_LIMITS_V1.maximumRowBytes || Buffer.byteLength(text, 'utf8') > PHOTO_QUERY_LIMITS_V1.maximumRowBytes) {
		throw new RangeError('Native query1 row exceeds its byte budget.');
	}
	const parsed: unknown = JSON.parse(text), row = readPhotoQueryRowV1(parsed);
	const bytes = field(input, 'file_name_key'), expected = lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort);
	if (field(input, 'photo_key') !== row.key || field(input, 'catalog_id') !== row.catalogId || field(input, 'photo_id') !== row.photoId
		|| field(input, 'photo_revision') !== row.summary.photoRevision || field(input, 'capture_bucket') !== row.captureBucket
		|| field(input, 'capture_sort') !== row.captureSort || field(input, 'rating_sort') !== row.ratingSort
		|| !(bytes instanceof Uint8Array) || bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index])) {
		throw new TypeError('Native query1 row disagrees with its scalar identity or index keys.');
	}
	return row;
}

/** This is genuine shared Build1 admission, independent of Build2 and browser
 * storage. The pure contract normalizes the bounded scoped continuation. */
export function readLightscaperNativeLegacyQueryBuildCurrentV1(value: unknown, expectedCatalogId: string): PhotoQueryBuildStateV1 {
	const input = record(value, 'native query1 build', ['catalog_id', 'ready', 'after_key', 'indexed_count']);
	const catalogId = id(field(input, 'catalog_id'), 'native query1 catalog');
	if (catalogId !== id(expectedCatalogId, 'requested native query1 catalog')) throw new TypeError('Native query1 build belongs to another catalog.');
	const ready = field(input, 'ready');
	if (ready !== 0 && ready !== 1) throw new TypeError('Native query1 readiness requires zero or one.');
	return readPhotoQueryBuildStateV1({ id: catalogId, schemaVersion: 1, ready: ready === 1,
		afterKey: field(input, 'after_key'), indexedCount: field(input, 'indexed_count') }, catalogId);
}
