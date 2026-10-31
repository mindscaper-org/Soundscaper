/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from '../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { nativeResourceIntegrationFixtureCurrentV1 as fixture, installNativeResourceBundleCurrentV1 as install,
	nativeResourceCatalogFootprintCurrentV1 as footprint, assertNativeResourceClosureCurrentV1 as assertClosure,
	nativeResourceOriginalBytesCurrentV1 as originalBytes } from './helpers/lightscaper-native-photo-resources-integration-fixture-current.ts';

const CATALOG = 'catalog-1';

test('Lightscaper actual native resources publish and reopen whole Photo3 process4 retained inactive redo snapshot and unused-input closure', async () => {
	await fixture(async f => {
		assertClosure(f.photo, f.bundles);
		for (const bundle of f.bundles) await install(f.resources, bundle);
		await f.store.storeOriginal(f.photo.original, originalBytes()); const published = await f.store.publishPhotos(CATALOG, 0, [f.photo]);
		assert.equal(published.photoCount, 1); assert.deepEqual(await f.store.loadPhoto(CATALOG, f.photo.id), f.photo);
		const key = photoStorageKey(CATALOG, f.photo.id), raw = f.catalog.prepare('SELECT summary FROM native_photos WHERE photo_key=?').get(key);
		assert.ok(raw); assert.equal(typeof raw.summary, 'string'); assert.deepEqual(JSON.parse(raw.summary as string) as unknown, photoSummary(f.photo));
		for (const [table, row] of [['native_photo_query_rows_v1', projectPhotoQueryRowV1(f.photo)], ['native_photo_query_rows_v2', projectPhotoQueryRowV2(f.photo)]] as const) {
			const stored = f.catalog.prepare(`SELECT row_json FROM ${table} WHERE photo_key=?`).get(key);
			assert.ok(stored); assert.equal(typeof stored.row_json, 'string'); assert.deepEqual(JSON.parse(stored.row_json as string) as unknown, row);
		}
		await f.store.close(); await f.resources.close();
		const resources = await Resources.open({ appDataPath: f.directory });
		const store = await Store.open({ appDataPath: f.directory, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal) });
		try {
			const photo = await store.loadPhoto(CATALOG, f.photo.id); assert.deepEqual(photo, f.photo); assert.ok(photo); assertClosure(photo, f.bundles);
			assert.equal(photo.schemaVersion, 3); assert.equal(photo.versions[0]!.develop.processVersion, 4); assert.equal(photo.versions[0]!.workspace?.schemaVersion, 4);
			await verifyPhotoResourcesCurrentV1(photo, resources);
			const luts = await resources.cubeLutResources(), masks = await resources.maskRasterResources();
			assert.equal(typeof luts.verifyReferencesV1, 'function'); assert.equal(typeof masks.verifyReferencesV1, 'function');
			for (const bundle of f.bundles) {
				await luts.source.withBytes(bundle.lut.reference, bytes => { assert.deepEqual(bytes, bundle.lut.bytes); });
				for (const body of bundle.brushes) await masks.source.withBytes(body.reference, bytes => { assert.deepEqual(bytes, body.bytes); });
			}
			assert.deepEqual(await store.readOriginal(CATALOG, photo.id, 0, 3), Uint8Array.of(1, 2, 3));
		} finally { await store.close(); await resources.close(); }
	});
});

for (const family of ['lut', 'brush'] as const) for (const failure of ['missing', 'tampered'] as const) {
	test(`Lightscaper genuine native ${family} ${failure} in inactive snapshot refuses import before Photo summary query or index publication`, async () => {
		await fixture(async f => {
			for (const bundle of f.bundles) await install(f.resources, bundle);
			await f.store.storeOriginal(f.photo.original, originalBytes()); const body = family === 'lut' ? f.bundles[5]!.lut : f.bundles[5]!.brushes[1]!;
			if (failure === 'missing') f.bodies.prepare('DELETE FROM native_photo_resources WHERE storage_key=?').run(body.reference.storageKey);
			else f.bodies.prepare('UPDATE native_photo_resources SET body=? WHERE storage_key=?').run(new Uint8Array(body.bytes.byteLength), body.reference.storageKey);
			const before = footprint(f.catalog); await assert.rejects(f.store.publishPhotos(CATALOG, 0, [f.photo]));
			assert.deepEqual(footprint(f.catalog), before); assert.equal(await f.store.loadPhoto(CATALOG, f.photo.id), null);
			assert.equal((await f.store.loadCatalog(CATALOG))?.photoCount, 0);
		});
	});
	test(`Lightscaper genuine native ${family} ${failure} refuses retained Current edit atomically while missing Original and resource-free edits remain independent`, async () => {
		await fixture(async f => {
			for (const bundle of f.bundles) await install(f.resources, bundle);
			const plain = normalizePhotoDocumentCurrentV1(photoArchiveFixture(2).photo);
			await f.store.storeOriginal(f.photo.original, originalBytes()); await f.store.storeOriginal(plain.original, originalBytes());
			await f.store.publishPhotos(CATALOG, 0, [f.photo, plain]);
			const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(f.directory);
			await rm(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, f.photo.original.contentSha256!));
			const body = family === 'lut' ? f.bundles[5]!.lut : f.bundles[5]!.brushes[1]!;
			if (failure === 'missing') f.bodies.prepare('DELETE FROM native_photo_resources WHERE storage_key=?').run(body.reference.storageKey);
			else f.bodies.prepare('UPDATE native_photo_resources SET body=? WHERE storage_key=?').run(new Uint8Array(body.bytes.byteLength), body.reference.storageKey);
			const before = footprint(f.catalog), edited = normalizePhotoDocumentCurrentV1({ ...f.photo, rating: 5 });
			await assert.rejects(f.store.savePhoto(edited, 0)); assert.deepEqual(footprint(f.catalog), before);
			assert.deepEqual(await f.store.loadPhoto(CATALOG, f.photo.id), f.photo);
			const snapshot = await f.store.readSnapshot(CATALOG), saved = await f.store.savePhoto({ ...plain, rating: 4 }, 0);
			assert.equal(saved.rating, 4); assert.equal(saved.revision, 1); assert.equal((await f.store.readSnapshot(CATALOG))?.indexRevision, snapshot!.indexRevision + 1);
			await assert.rejects(f.store.readOriginal(CATALOG, plain.id, 0, 1));
		});
	});
}

test('Lightscaper full native resource authentication permits metadata edit with unavailable Original and preserves complete retained process4 bytes', async () => {
	await fixture(async f => {
		for (const bundle of f.bundles) await install(f.resources, bundle);
		await f.store.storeOriginal(f.photo.original, originalBytes()); await f.store.publishPhotos(CATALOG, 0, [f.photo]);
		await rm(lightscaperNativePhotoOriginalBodyPathCurrentV1(deriveLightscaperNativePhotoOriginalPathsCurrentV1(f.directory), f.photo.original.contentSha256!));
		const saved = await f.store.savePhoto({ ...f.photo, rating: 5 }, 0);
		assert.equal(saved.revision, 1); assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.original, f.photo.original);
		assert.deepEqual(saved.versions, f.photo.versions); await verifyPhotoResourcesCurrentV1(saved, f.resources);
		await assert.rejects(f.store.readOriginal(CATALOG, saved.id, 0, 1));
	});
});

