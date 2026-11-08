/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionArchiveCaptureV1 } from '../src/lightscaper/catalog/photo-smart-collection-archive-capture-v1.ts';

const CATALOG = 'saved-native', COLLECTION = 'saved';
const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: CATALOG,
	name: 'Native saved collections', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const definition = () => normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG,
	id: COLLECTION, revision: 0, name: 'Saved criteria', query: normalizePhotoCatalogQueryV2() });
const state = (revision = 0, collectionCount = 0) => ({ schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: CATALOG, revision, collectionCount });
const methods = ['loadSmartCollection', 'readSmartCollectionState', 'readSmartCollectionPage', 'readSmartCollectionSnapshotV1',
	'saveSmartCollection', 'deleteSmartCollection', 'readSmartCollectionQueryPageV1', 'readSmartCollectionStackQueryPageV1',
	'readSmartCollectionArchiveContextV1', 'captureSmartCollectionArchiveV1'] as const;
function invoke(store: Store, methodName: string, args: unknown[]): Promise<unknown> {
	const method: unknown = Reflect.get(store, methodName);
	assert.equal(typeof method, 'function', `The actual newly created native SQLite library must implement ${methodName}.`);
	return Reflect.apply(method as (...values: unknown[]) => Promise<unknown>, store, args);
}
async function create(store: Store): Promise<unknown> {
	return await invoke(store, 'saveSmartCollection', [definition(), null, { expectedCatalogRevision: 0, expectedIndexRevision: 0, expectedStateRevision: 0 }]);
}
async function fixture(run: (store: Store) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper saved owner RED ü ')));
	const store = await Store.open({ appDataPath: directory });
	try { await store.createCatalog(root()); await run(store); }
	finally { await store.close(); }
	// A failed fixture is retained for Root until the entire verification process joins.
	await rm(directory, { recursive: true, force: false });
}

for (const method of methods) {
	test(`Lightscaper genuine saved native owner implements ${method} after actual FS and SQLite creation`, async () => {
		await fixture(async store => {
			// These imports and the real Store/create path already exist on E78.
			// Missing-method RED occurs here, after durable native creation, never
			// at a missing schema/module/helper import or an IDB compatibility facade.
			assert.equal(typeof Reflect.get(store, method), 'function', `Missing genuine native owner method: ${method}`);
			if (method === 'loadSmartCollection') assert.equal(await invoke(store, method, [CATALOG, 'missing']), null);
			else if (method === 'readSmartCollectionState') assert.deepEqual(await invoke(store, method, [CATALOG]), state());
			else if (method === 'readSmartCollectionPage') assert.deepEqual(await invoke(store, method, [CATALOG]), { items: [], continuation: null });
			else if (method === 'readSmartCollectionSnapshotV1') assert.deepEqual(await invoke(store, method, [CATALOG, null]), {
				schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: null,
				context: { catalogId: CATALOG, catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 }, definition: null });
			else if (method === 'saveSmartCollection') assert.deepEqual(await create(store), { schemaVersion: 1, kind: 'photo-smart-collection-write',
				catalogId: CATALOG, catalogRevision: 1, indexRevision: 1, state: state(1, 1), definition: definition() });
			else if (method === 'deleteSmartCollection') {
				await create(store); assert.deepEqual(await invoke(store, method, [CATALOG, COLLECTION, 0, { expectedCatalogRevision: 1, expectedIndexRevision: 1, expectedStateRevision: 1 }]),
					{ schemaVersion: 1, kind: 'photo-smart-collection-write', catalogId: CATALOG, catalogRevision: 2, indexRevision: 2, state: state(2), definition: null });
			} else if (method === 'readSmartCollectionQueryPageV1' || method === 'readSmartCollectionStackQueryPageV1') {
				await create(store); const page = await invoke(store, method, [CATALOG, COLLECTION]); assert.ok(page && typeof page === 'object');
				assert.equal(Reflect.get(page, 'schemaVersion'), 1); assert.equal(Reflect.get(page, 'kind'), 'saved-photo-query-page');
				assert.equal(Reflect.get(page, 'mode'), method === 'readSmartCollectionQueryPageV1' ? 'ordinary' : 'collapsed'); assert.equal(Reflect.get(page, 'collectionId'), COLLECTION);
				assert.deepEqual(Reflect.get(page, 'items'), []); assert.equal(Reflect.get(page, 'continuation'), null);
			} else if (method === 'readSmartCollectionArchiveContextV1') assert.deepEqual(await invoke(store, method, [CATALOG]), {
				schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: CATALOG, catalogRevision: 0, indexRevision: 0, state: null });
			else {
				const capture = await invoke(store, method, [CATALOG]) as PhotoSmartCollectionArchiveCaptureV1;
				assert.equal(capture.context.state, null); const delivered: unknown[] = [];
				for await (const value of capture.definitions) delivered.push(value);
				assert.deepEqual(delivered, []); await capture.verify();
			}
		});
	});
}
