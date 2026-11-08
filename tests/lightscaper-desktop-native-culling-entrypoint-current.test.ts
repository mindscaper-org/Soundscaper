/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { normalizePhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const contexts: readonly (readonly [string, PhotoLibraryCullingNavigationContextV1])[] = [
	['plain', { kind: 'plain' }],
	...([1, 2] as const).flatMap(version => [false, true].map(collapsed => [
		`Query${String(version)} ${collapsed ? 'collapsed' : 'ordinary'}`,
		{ kind: 'query' as const, query: version === 1 ? normalizePhotoCatalogQueryV1() : normalizePhotoCatalogQueryV2(), collapsed }
	] as const)),
	...[false, true].map(collapsed => [`saved ${collapsed ? 'collapsed' : 'ordinary'}`,
		{ kind: 'saved' as const, collectionId: 'saved', collapsed }] as const)
];

for (const [name, context] of contexts) test(`Lightscaper genuine native culling ${name} reaches the stored Current Photo after actual library creation`, async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native culling entry ü ')));
	const store = await Store.open({ appDataPath: directory }), root = nativeCatalogRootCurrentV1(), photos = [nativePhotoCurrentV1(1), nativePhotoCurrentV1(2)];
	try {
		await store.createCatalog(root);
		for (const photo of photos) await store.storeOriginal(photo.original, (async function* () { yield Uint8Array.of(1, 2, 3); })());
		await store.publishPhotos(root.id, 0, photos);
		await store.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'saved', name: 'Saved',
			revision: 0, query: normalizePhotoCatalogQueryV2() }, null, { expectedCatalogRevision: 1, expectedIndexRevision: 1, expectedStateRevision: 0 });
		// This check follows genuine Original custody and native SQLite writes;
		// the pre-implementation failure is the missing repository capability.
		const method: unknown = Reflect.get(store, 'readCullingDestinationPage');
		assert.equal(typeof method, 'function', 'The actual native owner must implement every culling destination path.');
		const page = await Reflect.apply(method as (...args: unknown[]) => Promise<PhotoLibraryPageV1 | null>, store,
			[root.id, context, { photoId: photos[0]!.id }]);
		assert.deepEqual(page, { catalogName: root.name, totalCount: 2, rows: photos.map(photo => ({ id: photo.id,
			fileName: photo.metadata.fileName, width: photo.original.width, height: photo.original.height,
			rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel })), cursor: null });
	} finally { await store.close(); }
	// Failed fixtures stay owned by Root until every verification process joins.
	await rm(directory, { recursive: true, force: false });
});
