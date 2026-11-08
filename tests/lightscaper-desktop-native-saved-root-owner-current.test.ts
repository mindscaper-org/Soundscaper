/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { nativeCatalogRootCurrentV1, nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';

const CATALOG = 'catalog', SAVED = 'saved-criteria', LEGACY_SAVED = 'saved-legacy';
const TABLES = ['native_photo_catalogs', 'native_photos', 'native_photo_memberships', 'native_photo_query_rows_v1',
	'native_photo_query_builds_v1', 'native_photo_query_rows_v2', 'native_photo_query_builds_v2', 'native_photo_stacks',
	'native_photo_stack_states', 'native_photo_stack_forward_members', 'native_photo_stack_memberships',
	'native_photo_smart_collections', 'native_photo_smart_collection_summaries', 'native_photo_smart_collection_states'] as const;
const preservedTables = TABLES.filter(table => table !== 'native_photo_catalogs');
const root = () => {
	const base = nativeCatalogRootCurrentV1();
	return normalizePhotoCatalogRootV1({ ...base, folders: [...base.folders, { id: 'saved-folder', name: 'Saved only', parentId: null }],
		keywords: [...base.keywords, { id: 'saved-keyword', name: 'Saved only', parentId: null }],
		collections: [...base.collections, { id: 'saved-manual', name: 'Saved only', kind: 'manual' }] });
};
function definition(id: string, collectionId: string) {
	return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG, id, name: id, revision: 0,
		query: { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: { kind: 'collection', id: collectionId },
			sort: { field: 'photo-id', direction: 'ascending' }, predicate: { kind: 'all', terms: [
				// Neither source has known ISO. A matcher can stop here, but reference admission must still visit both negative branches.
				{ kind: 'presence', column: 'iso', value: 'known' },
				{ kind: 'not', term: { kind: 'folder', id: 'saved-folder' } },
				{ kind: 'not', term: { kind: 'keyword', id: 'saved-keyword' } }
			] } } });
}
async function* body() { yield Uint8Array.of(1, 2, 3); }
function snapshot(database: DatabaseSync, tables: readonly string[] = TABLES) {
	return tables.map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() }));
}
async function seed(store: Store) {
	await store.createCatalog(root()); const photos = [nativePhotoCurrentV1(1), nativePhotoCurrentV1(2)];
	for (const photo of photos) await store.storeOriginal(photo.original, body());
	await store.publishPhotos(CATALOG, 0, photos);
	const stack = normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: CATALOG, id: 'native-group', revision: 0,
		photoIds: photos.map(photo => photo.id), coverPhotoId: photos[1]!.id });
	await store.saveStack(stack, null, { expectedCatalogRevision: 1, expectedStateRevision: 0 });
	await store.saveSmartCollection(definition(SAVED, 'saved-manual'), null, { expectedCatalogRevision: 2, expectedIndexRevision: 2, expectedStateRevision: 0 });
	await store.saveSmartCollection(definition(LEGACY_SAVED, 'smart'), null, { expectedCatalogRevision: 3, expectedIndexRevision: 3, expectedStateRevision: 1 });
	const current = await store.loadCatalog(CATALOG); assert.ok(current); assert.equal(current.revision, 4);
	return { current, photos, stack };
}
async function fixture(run: (store: Store, database: DatabaseSync, seeded: Awaited<ReturnType<typeof seed>>) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper saved root owner ü ')));
	const store = await Store.open({ appDataPath: directory }); let database: DatabaseSync | undefined;
	let failed = false, failure: unknown; const cleanup: unknown[] = [];
	try {
		const seeded = await seed(store);
		database = new DatabaseSync(deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath, { readOnly: true });
		await run(store, database, seeded);
	} catch (error) { failed = true; failure = error; }
	try { database?.close(); } catch (error) { cleanup.push(error); }
	try { await store.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Native saved root owner test retirement failed.');
	if (failed) throw failure;
	// Failures retain their owned directory until Root joins the complete verification process.
	await rm(directory, { recursive: true, force: false });
}

test('Lightscaper genuine saved root owner refuses all negative-branch and manual or legacy collection removals atomically', async () => {
	await fixture(async (store, database, { current }) => {
		const before = snapshot(database);
		const candidates = [
			{ ...current, folders: current.folders.filter(node => node.id !== 'saved-folder') },
			{ ...current, keywords: current.keywords.filter(node => node.id !== 'saved-keyword') },
			{ ...current, collections: current.collections.filter(node => node.id !== 'saved-manual') },
			{ ...current, collections: current.collections.filter(node => node.id !== 'smart') }
		];
		for (const candidate of candidates) {
			await assert.rejects(store.saveCatalog(candidate, 4), ReferenceError);
			assert.deepEqual(snapshot(database), before); assert.deepEqual(await store.loadCatalog(CATALOG), current);
		}
	});
});

test('Lightscaper genuine saved root owner refuses saved and root collection ID collisions before publication', async () => {
	await fixture(async (store, database, { current }) => {
		const before = snapshot(database), collision = { ...current, collections: [...current.collections, { id: SAVED, name: 'Collision', kind: 'manual' }] };
		await assert.rejects(store.saveCatalog(collision, 4), /disjoint|collision|saved/iu);
		assert.deepEqual(snapshot(database), before); assert.deepEqual(await store.loadCatalog(CATALOG), current);
	});
});

test('Lightscaper genuine saved root rename advances only root and index while native Photos queries stacks and saved state authority persist', async () => {
	await fixture(async (store, database, { current, photos, stack }) => {
		const preserved = snapshot(database, preservedTables), state = await store.readSmartCollectionState(CATALOG);
		assert.equal(state.revision, 2); assert.equal(state.collectionCount, 2);
		const renamed = await store.saveCatalog({ ...current, name: 'Harmless rename' }, 4);
		assert.deepEqual(renamed, { ...current, name: 'Harmless rename', revision: 5 });
		assert.equal((await store.readSnapshot(CATALOG))?.indexRevision, 5); assert.deepEqual(snapshot(database, preservedTables), preserved);
		assert.deepEqual(await store.readSmartCollectionState(CATALOG), state);
		assert.deepEqual(await store.loadSmartCollection(CATALOG, SAVED), definition(SAVED, 'saved-manual'));
		assert.deepEqual(await store.loadSmartCollection(CATALOG, LEGACY_SAVED), definition(LEGACY_SAVED, 'smart'));
		assert.deepEqual(await store.loadStack(CATALOG, stack.id), stack);
		const ids = photos.map(photo => photo.id).sort();
		assert.deepEqual((await store.readQueryPage(CATALOG)).items.map(photo => photo.photoId), ids);
		assert.deepEqual((await store.readQueryPageV2(CATALOG)).items.map(photo => photo.photoId), ids);
		assert.deepEqual((await store.readSmartCollectionQueryPageV1(CATALOG, SAVED)).items, []);
		for (const photo of photos) {
			assert.deepEqual(await store.loadPhoto(CATALOG, photo.id), photo);
			assert.deepEqual(await store.readOriginal(CATALOG, photo.id, 0, 3), Uint8Array.of(1, 2, 3));
		}
	});
});
