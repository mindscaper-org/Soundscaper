/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readLightscaperNativeLegacyQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-legacy-query-pages-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { readPhotoQueryContinuationV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { writeNativeStackQueryRowCurrentV1 } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import { legacyQueryFixtureCurrentV1 as fixture, seedNativeLegacyQueryCurrentV1 as seed, legacyQueryCurrentV1 as query,
	legacyTransactionCurrentV1 as tx, putLegacyQueryRowCurrentV1 as put } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';

test('Lightscaper native legacy outgoing filename continuation refuses a genuine maximal JSON position above2048 bytes', async () => {
	await fixture(db => {
		const f = seed(db, 0), catalogId = 'c'.repeat(128), fileName = '\ud800'.repeat(256);
		const root = normalizePhotoCatalogRootV1({ ...f.root, id: catalogId, photoCount: 65 });
		tx(db, () => {
			db.prepare('INSERT INTO native_photo_catalogs VALUES(?,?,?,?,?)').run(catalogId, json(root), root.revision, 65, 11);
			db.prepare('INSERT INTO native_photo_query_builds_v1 VALUES(?,1,NULL,65)').run(catalogId);
			db.prepare('INSERT INTO native_photo_query_builds_v2 VALUES(?,1,NULL,65)').run(catalogId);
			db.prepare('INSERT INTO native_photo_stack_states VALUES(?,5,0)').run(catalogId);
			for (let i = 0; i < 65; i++) {
				const before = nativePhotoCurrentV1(i), photoId = 'p'.repeat(122) + String(i).padStart(6,'0');
				const photo = normalizePhotoDocumentCurrentV1({ ...before, id: photoId, catalogId, metadata: { ...before.metadata, fileName } });
				db.prepare('INSERT INTO native_photos VALUES(?,?,?,?,?,?)').run(photoStorageKey(catalogId, photoId), catalogId, photoId, photo.revision, json(photo), json(photoSummary(photo)));
				put(db, projectPhotoQueryRowV1(photo)); writeNativeStackQueryRowCurrentV1(db, projectPhotoQueryRowV2(photo));
			}
		});
		const selected = query({ sort: { field: 'file-name', direction: 'ascending' } });
		assert.throws(() => read(db, catalogId, { query: selected }), /continuation.*byte budget|cursor.*bound/iu);
		assert.equal(db.isTransaction, false); assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_query_rows_v1 WHERE catalog_id=?').get(catalogId)?.count, 65);
		// The same genuine sources have a legal smaller photo-ID position. A bound
		// refusal neither truncates the filename nor disables the legacy profile.
		const ordinary = query(), first = read(db, catalogId, { query: ordinary }); assert.ok(first.continuation);
		assert.ok(Buffer.byteLength(JSON.stringify(first.continuation)) <= 2048);
		assert.deepEqual(readPhotoQueryContinuationV1(first.continuation, catalogId, ordinary), first.continuation);
		assert.equal(read(db, catalogId, { query: ordinary, continuation: first.continuation }).items.length, 1);
	});
});
