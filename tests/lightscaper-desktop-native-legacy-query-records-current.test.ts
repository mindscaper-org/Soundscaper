/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readLightscaperNativeLegacyQueryBuildCurrentV1, readLightscaperNativeLegacyQueryRowCurrentV1 } from '../desktop/lightscaper-native-legacy-query-records-current-v1.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from '../desktop/lightscaper-native-query-records-current-v1.ts';
import { normalizePhotoDocumentCurrentV1, upgradePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { projectPhotoQueryRowV1, readPhotoQueryBuildStateV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { PHOTO_QUERY_LIMITS_V1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const current = nativePhotoCurrentV1();
function nativeRow(photo: PhotoDocumentCurrentV1 = current, changes: Record<string, unknown> = {}) {
	const row = projectPhotoQueryRowV1(photo);
	return { photo_key: row.key, catalog_id: row.catalogId, photo_id: row.photoId, photo_revision: row.summary.photoRevision,
		row_json: JSON.stringify(row), file_name_key: lightscaperNativeQueryFileNameKeyCurrentV1(row.fileNameSort),
		capture_bucket: row.captureBucket, capture_sort: row.captureSort, rating_sort: row.ratingSort, ...changes };
}

test('Lightscaper native Legacy Query1 row reader retains exact Current1/2/3 projection and binds every native scalar to nested summary revision', () => {
	for (const photo of [current, upgradePhotoDocumentV2(current), upgradePhotoDocumentCurrentV1(current)]) {
		const row = projectPhotoQueryRowV1(photo), actual = readLightscaperNativeLegacyQueryRowCurrentV1(nativeRow(photo));
		assert.deepEqual(actual, row); assert.ok(Object.isFrozen(actual)); assert.ok(Object.isFrozen(actual.summary));
		assert.equal(Object.hasOwn(actual, 'photoRevision'), false); assert.equal(actual.summary.photoRevision, photo.revision);
	}
	const row = projectPhotoQueryRowV1(current);
	for (const change of [{ photo_key: 'catalog|wrong' }, { catalog_id: 'other' }, { photo_id: 'wrong' }, { photo_revision: 1 },
		{ capture_bucket: 0 }, { capture_sort: '2026-01-01T00:00:00.000' }, { rating_sort: 5 }, { extra: 1 },
		{ file_name_key: Buffer.from(row.fileNameSort, 'utf8') }, { file_name_key: new Uint8Array([0, 97]) }, { file_name_key: null },
		{ row_json: '{broken' }, { row_json: JSON.stringify({ ...row, schemaVersion: 2 }) },
		{ row_json: JSON.stringify({ ...row, summary: { ...row.summary, photoId: 'other' } }) }, { row_json: 1 }]) {
		assert.throws(() => readLightscaperNativeLegacyQueryRowCurrentV1(nativeRow(current, change)));
	}
	let invoked = false; const accessor = nativeRow();
	Object.defineProperty(accessor, 'row_json', { enumerable: true, get() { invoked = true; return ''; } });
	assert.throws(() => readLightscaperNativeLegacyQueryRowCurrentV1(accessor)); assert.equal(invoked, false);
	assert.throws(() => readLightscaperNativeLegacyQueryRowCurrentV1(nativeRow(current, { row_json: 'ä'.repeat(PHOTO_QUERY_LIMITS_V1.maximumRowBytes) })), RangeError);
});

test('Lightscaper native Legacy Query1 reader preserves expanded lowercase UTF16 filename keys and rejects UTF8 or altered units', () => {
	const photo = normalizePhotoDocumentCurrentV1({ ...current, revision: 17, metadata: { ...current.metadata, fileName: 'İ'.repeat(256) } });
	const row = projectPhotoQueryRowV1(photo), native = nativeRow(photo);
	assert.equal(row.fileNameSort.length, 512); assert.equal(native.file_name_key.length, 1024);
	assert.deepEqual(readLightscaperNativeLegacyQueryRowCurrentV1(native), row);
	assert.throws(() => readLightscaperNativeLegacyQueryRowCurrentV1({ ...native, photo_revision: 0 }));
	assert.throws(() => readLightscaperNativeLegacyQueryRowCurrentV1({ ...native, file_name_key: Buffer.from(row.fileNameSort, 'utf8') }));
	const altered = native.file_name_key.slice(); altered[altered.length - 1] = 0;
	assert.throws(() => readLightscaperNativeLegacyQueryRowCurrentV1({ ...native, file_name_key: altered }));
});

test('Lightscaper native Legacy Query1 build reader maps exact four fields to genuine shared Build1 without Query2 inference', () => {
	const native = { catalog_id: 'catalog', ready: 0, after_key: `catalog|${current.id}`, indexed_count: 2 };
	const expected = readPhotoQueryBuildStateV1({ id: 'catalog', schemaVersion: 1, ready: false, afterKey: native.after_key, indexedCount: 2 }, 'catalog');
	assert.deepEqual(readLightscaperNativeLegacyQueryBuildCurrentV1(native, 'catalog'), expected);
	assert.deepEqual(readLightscaperNativeLegacyQueryBuildCurrentV1({ catalog_id: 'catalog', ready: 1, after_key: null, indexed_count: 0 }, 'catalog'),
		{ id: 'catalog', schemaVersion: 1, ready: true, afterKey: null, indexedCount: 0 });
	for (const change of [{ catalog_id: 'other' }, { ready: true }, { ready: 2 }, { after_key: 'other|photo' }, { after_key: 'catalog|wrong|photo' },
		{ after_key: 'catalog|' }, { after_key: undefined }, { indexed_count: -1 }, { indexed_count: 10_000_001 }, { indexed_count: 1.5 }, { extra: 1 }]) {
		assert.throws(() => readLightscaperNativeLegacyQueryBuildCurrentV1({ ...native, ...change }, 'catalog'));
	}
	assert.throws(() => readLightscaperNativeLegacyQueryBuildCurrentV1(native, 'other'));
	let invoked = false; const accessor = { ...native };
	Object.defineProperty(accessor, 'ready', { enumerable: true, get() { invoked = true; return 1; } });
	assert.throws(() => readLightscaperNativeLegacyQueryBuildCurrentV1(accessor, 'catalog')); assert.equal(invoked, false);
});
