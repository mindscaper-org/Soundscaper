/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { catalogRestoreRecordsCurrentV1 as records, nativeCatalogRestoreFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-catalog-restore-fixture-current.ts';

void test('Lightscaper native restore retains a complete legal Row1-overflow Photo with ready Row2 and unready Row1', { timeout: 15_000 }, async context => fixture(context, async f => {
	const r = records(1), members = (prefix: string) => Array.from({ length: 1024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
	const root = normalizePhotoCatalogRootV1({ ...r.root, keywords: members('k').map(id => ({ id, name: 'Keyword', parentId: null })),
		collections: members('c').map(id => ({ id, name: 'Manual', kind: 'manual' })) });
	const words = '\ud800'.repeat(16_384), base = r.photos[0]!, photo = normalizePhotoDocumentCurrentV1({ ...base,
		keywordIds: members('k'), collectionIds: members('c'), metadata: { ...base.metadata, title: words, caption: words, creator: words, copyright: words, location: words } });
	assert.throws(() => projectPhotoQueryRowV1(photo), /byte budget/u);
	const { stage, database } = await f.create(root); await stage.writePhoto(photo); const ready = await stage.finish(); assert.equal(ready.photoCount, 1);
	assert.deepEqual({ ...database.prepare('SELECT ready,indexed_count FROM native_photo_query_builds_v1').get() }, { ready: 0, indexed_count: 0 });
	assert.deepEqual({ ...database.prepare('SELECT ready,indexed_count FROM native_photo_query_builds_v2').get() }, { ready: 1, indexed_count: 1 });
	assert.equal(database.prepare('SELECT COUNT(*) AS n FROM native_photo_query_rows_v1').get()?.n, 0);
	assert.equal(database.prepare('SELECT COUNT(*) AS n FROM native_photo_memberships').get()?.n, 2051);
}));
