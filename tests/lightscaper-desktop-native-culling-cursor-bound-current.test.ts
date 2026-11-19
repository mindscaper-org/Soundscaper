/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeCullingDestinationPageCurrentV1 as destination } from '../desktop/lightscaper-native-culling-current-v1.ts';
import { readLightscaperNativeQueryPageCurrentV1 as readQuery } from '../desktop/lightscaper-native-query-pages-current-v1.ts';
import { readLightscaperNativeSmartCollectionQueryPageCurrentV1 as readSaved } from '../desktop/lightscaper-native-smart-collection-query-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoCatalogQueryV1, photoQueryDigestV1, readPhotoQueryContinuationV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { photoQueryDigestV2, readPhotoQueryContinuationV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { nativeCullingFixtureCurrentV1 as fixture, queryV2 } from './helpers/lightscaper-native-culling-fixture-current.ts';
import { putLegacyQueryRowCurrentV1 } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';
import { writeNativeStackQueryRowCurrentV1 } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import { insertNativeSmartCollectionFixtureCurrentV1 } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';

function maximalPosition(database: DatabaseSync) {
	const catalogId = 'c'.repeat(128), fileName = '\ud800'.repeat(256);
	const root = normalizePhotoCatalogRootV1({ ...nativeCatalogRootCurrentV1(), id: catalogId, revision: 3, photoCount: 65 });
	const query = queryV2({ sort: { field: 'file-name', direction: 'ascending' } });
	database.exec('BEGIN IMMEDIATE');
	try {
		database.prepare('INSERT INTO native_photo_catalogs VALUES(?,?,?,?,?)').run(catalogId, JSON.stringify(root), 3, 65, 11);
		database.prepare('INSERT INTO native_photo_query_builds_v1 VALUES(?,1,NULL,65)').run(catalogId);
		database.prepare('INSERT INTO native_photo_query_builds_v2 VALUES(?,1,NULL,65)').run(catalogId);
		database.prepare('INSERT INTO native_photo_stack_states VALUES(?,5,0)').run(catalogId);
		for (let index = 0; index < 65; index++) {
			const base = nativePhotoCurrentV1(index), photoId = 'p'.repeat(122) + String(index).padStart(6, '0');
			const photo = normalizePhotoDocumentCurrentV1({ ...base, id: photoId, catalogId, metadata: { ...base.metadata, fileName } });
			database.prepare('INSERT INTO native_photos VALUES(?,?,?,?,?,?)')
				.run(photoStorageKey(catalogId, photoId), catalogId, photoId, photo.revision, JSON.stringify(photo), JSON.stringify(photoSummary(photo)));
			putLegacyQueryRowCurrentV1(database, projectPhotoQueryRowV1(photo)); writeNativeStackQueryRowCurrentV1(database, projectPhotoQueryRowV2(photo));
		}
		insertNativeSmartCollectionFixtureCurrentV1(database, normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection',
			catalogId, id: 'saved', name: 'Legal larger saved cursor', revision: 2, query }));
		database.prepare('INSERT INTO native_photo_smart_collection_states VALUES(?,7,1)').run(catalogId); database.exec('COMMIT');
	} catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
	return { catalogId, query, selectedId: 'p'.repeat(122) + '000000', lastId: 'p'.repeat(122) + '000064' };
}

test('Lightscaper native culling ordinary Query2 preserves legal4KiB positions and resumes through its actual native reader', async () => {
	await fixture(async database => {
		const f = maximalPosition(database), first = await destination(database, f.catalogId, { kind: 'query', query: f.query, collapsed: false },
			{ photoId: f.selectedId });
		assert.ok(first); assert.equal(first.rows[0]?.id, f.selectedId); assert.equal(first.rows.length, 64); assert.ok(first.cursor);
		assert.ok(Buffer.byteLength(first.cursor) > 2048 && Buffer.byteLength(first.cursor) <= 4096);
		const next = readQuery(database, f.catalogId, { query: f.query, continuation: JSON.parse(first.cursor) as unknown });
		assert.deepEqual(next.items.map(row => row.photoId), [f.lastId]); assert.equal(next.continuation, null); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native culling keeps legal saved4KiB final positions independent of the ordinary Query2 parser cap', async () => {
	await fixture(async database => {
		const f = maximalPosition(database), first = await destination(database, f.catalogId, { kind: 'saved', collectionId: 'saved', collapsed: false },
			{ photoId: f.selectedId });
		assert.ok(first); assert.equal(first.rows[0]?.id, f.selectedId); assert.equal(first.rows.length, 64); assert.ok(first.cursor);
		assert.ok(Buffer.byteLength(first.cursor) > 2048 && Buffer.byteLength(first.cursor) <= 4096);
		const next = readSaved(database, f.catalogId, 'saved', { continuation: JSON.parse(first.cursor) as unknown });
		assert.deepEqual(next.items.map(row => row.photoId), [f.lastId]); assert.equal(next.continuation, null); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper owning Query2 admits a genuine2to4KiB position while the same legacy position preserves its2KiB refusal', () => {
	const catalogId = 'c'.repeat(128), fileName = '\ud800'.repeat(256), photoId = 'p'.repeat(128);
	const sort = { field: 'file-name', direction: 'ascending' }, query = queryV2({ sort }), legacy = normalizePhotoCatalogQueryV1({ sort });
	const position = { captureBucket: 0, afterKey: [catalogId, fileName.toLowerCase(), photoId] };
	const metadata = { schemaVersion: 2, kind: 'photo-query', catalogId, catalogRevision: 3, indexRevision: 11,
		querySha256: photoQueryDigestV2(query), ...position };
	const older = { schemaVersion: 1, catalogId, indexRevision: 11, querySha256: photoQueryDigestV1(legacy), ...position };
	assert.ok(Buffer.byteLength(JSON.stringify(metadata)) > 2048 && Buffer.byteLength(JSON.stringify(metadata)) <= 4096);
	assert.deepEqual(readPhotoQueryContinuationV2(metadata, catalogId, query), metadata);
	assert.throws(() => readPhotoQueryContinuationV1(older, catalogId, legacy), /continuation.*byte budget/iu);
});
