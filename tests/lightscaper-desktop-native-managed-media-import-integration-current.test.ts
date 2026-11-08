/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importManagedPhotosCurrentV1 } from '../src/lightscaper/import/managed-import-current-v1.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizeCatalogOriginalRoot } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { assertNativeResourceClosureCurrentV1 } from './helpers/lightscaper-native-photo-resources-integration-fixture-current.ts';
import { managedMediaIntegrationFixtureCurrentV1 as fixture, MANAGED_MEDIA_CATALOG_CURRENT_V1 as CATALOG,
	managedMediaIntegrationReadCurrentV1 as read } from './helpers/lightscaper-native-managed-media-integration-fixture-current.ts';
import { managedMediaIntegrationInputsCurrentV1 as inputs, managedMediaIntegrationShaCurrentV1 as digest } from './helpers/lightscaper-native-managed-media-integration-fixture-inputs-current.ts';

test('Lightscaper actual native media offers captured own publication/read methods and the complete seven-method custody facet', async () => {
	await fixture(async f => {
		for (const key of ['writeAsset', 'getAssetMetadata', 'deleteAsset', 'verifyOriginal', 'readOriginal'] as const) {
			const descriptor = Object.getOwnPropertyDescriptor(f.media, key); assert.ok(descriptor && Object.hasOwn(descriptor, 'value')); assert.equal(typeof descriptor.value, 'function');
		}
		assert.equal(Object.isFrozen(f.media.catalogOriginals), true);
		const names = ['retain', 'stage', 'release', 'releaseStaged', 'promote', 'readPage', 'findDigestPage'];
		assert.deepEqual(Object.keys(f.media.catalogOriginals).sort(), names.sort());
		for (const key of names) {
			const descriptor = Object.getOwnPropertyDescriptor(f.media.catalogOriginals, key); assert.ok(descriptor && Object.hasOwn(descriptor, 'value')); assert.equal(typeof descriptor.value, 'function');
		}
	});
});

test('Lightscaper Current importer publishes real encoded raster RAW HDR and whole Photo1/2/3 process1..4 through actual native owners and reopens exact bytes', async () => {
	await fixture(async f => {
		const data = await inputs(); await data.install(f); assertNativeResourceClosureCurrentV1(data.entries[3].photo, data.bundles);
		const events: string[] = [];
		const receipts = await importManagedPhotosCurrentV1(CATALOG, data.entries.map(({ photo, original }) => ({ photo, original })), f.ports,
			{ onPublished: receipt => { assert.equal(receipt.status, 'imported'); events.push(receipt.photoId!); } });
		assert.deepEqual(receipts.map(receipt => [receipt.status, receipt.reusedOriginal]), [['imported', false], ['imported', true], ['imported', false], ['imported', true], ['imported', false]]);
		assert.deepEqual(events, data.entries.map(entry => entry.photo.id)); assert.equal((await f.catalog.loadCatalog(CATALOG))?.photoCount, 5);
		assert.deepEqual(await f.settings.settingsRepository.readEntry(photoImportIntentKeyV1(CATALOG)), { present: false });
		const roots = await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null });
		assert.equal(roots.afterKey, null); assert.equal(roots.roots.length, 5);
		for (const entry of data.entries) {
			const photo = await f.catalog.loadPhoto(CATALOG, entry.photo.id); assert.ok(photo);
			const assetId = entry.photo.id === 'photo-2' ? 'original-1' : entry.photo.id === 'photo-4' ? 'original-3' : entry.photo.original.storageKey;
			assert.deepEqual(photo, normalizePhotoDocumentCurrentV1({ ...entry.photo, original: { ...entry.photo.original, storageKey: assetId } }));
			const metadata = await f.media.getAssetMetadata(assetId); assert.ok(metadata); assert.equal(metadata.sha256, digest(entry.bytes)); assert.equal(metadata.size, entry.bytes.length);
			await f.media.verifyOriginal(photo.original); assert.deepEqual(await read(f.media, photo.original), entry.bytes);
			const root = normalizeCatalogOriginalRoot(roots.roots.find(value => value.photoId === photo.id));
			assert.equal(root.assetId, assetId); assert.equal(root.sourceId, entry.photo.original.id); assert.equal(root.sha256, digest(entry.bytes)); assert.equal(root.size, entry.bytes.length);
			assert.equal(root.importId, null); assert.match(root.mediaContentToken, /^media-content-[a-z0-9][a-z0-9-]{15,127}$/u);
		}
		assert.equal(await f.media.getAssetMetadata('original-2'), null); assert.equal(await f.media.getAssetMetadata('original-4'), null);
		const dedupe = await f.media.catalogOriginals.findDigestPage(digest(data.entries[0].bytes));
		assert.deepEqual(dedupe.matches.map(value => value.assetId), ['original-1']);
		await assert.rejects(f.media.deleteAsset('original-1'));
		await f.close(); const reopened = await f.reopen();
		for (const entry of data.entries) {
			const photo = await reopened.catalog.loadPhoto(CATALOG, entry.photo.id); assert.ok(photo); await verifyPhotoResourcesCurrentV1(photo, reopened.resources);
			assert.deepEqual(await read(reopened.media, photo.original), entry.bytes);
		}
		assert.equal((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots.length, 5);
		assert.equal((await reopened.catalog.readSummaryPage(CATALOG)).items.length, 5);
		// Encoded persistence and real resource verification are qualified here;
		// no browser/native image decoder or scoped Blob loader is substituted.
	});
});

test('Lightscaper genuine Current retained-resource refusal happens before asset publication or custody', async () => {
	await fixture(async f => {
		const data = await inputs(), entry = data.entries[3];
		const result = await importManagedPhotosCurrentV1(CATALOG, [{ photo: entry.photo, original: entry.original }], f.ports);
		assert.equal(result[0]?.status, 'failed'); assert.equal(await f.media.getAssetMetadata(entry.photo.original.storageKey), null);
		assert.equal(await f.catalog.loadPhoto(CATALOG, entry.photo.id), null); assert.equal((await f.catalog.loadCatalog(CATALOG))?.photoCount, 0);
		assert.deepEqual((await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots, []);
		assert.deepEqual(await f.settings.settingsRepository.readEntry(photoImportIntentKeyV1(CATALOG)), { present: false });
		await data.install(f);
		assert.equal((await importManagedPhotosCurrentV1(CATALOG, [{ photo: entry.photo, original: entry.original }], f.ports))[0]?.status, 'imported');
	});
});

test('Lightscaper Current digest mismatch refuses real native asset/root publication and a later exact retry succeeds', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0];
		const bad = await importManagedPhotosCurrentV1(CATALOG, [{ photo: entry.photo, original: new Blob([new Uint8Array(entry.bytes.length)]) }], f.ports);
		assert.equal(bad[0]?.status, 'failed'); assert.equal(await f.media.getAssetMetadata(entry.photo.original.storageKey), null);
		assert.equal(await f.catalog.loadPhoto(CATALOG, entry.photo.id), null);
		assert.equal((await importManagedPhotosCurrentV1(CATALOG, [{ photo: entry.photo, original: entry.original }], f.ports))[0]?.status, 'imported');
		assert.deepEqual(await read(f.media, entry.photo.original), entry.bytes);
	});
});

test('Lightscaper Current publication observer cannot revoke an actual catalog ACK by throwing an opaque value', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0]; let traps = 0, observed = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque observer get'); }, getPrototypeOf() { traps++; throw Error('Opaque observer prototype'); } });
		const receipt = await importManagedPhotosCurrentV1(CATALOG, [{ photo: entry.photo, original: entry.original }], f.ports, { onPublished() { observed++; throw reason; } });
		assert.equal(observed, 1); assert.equal(traps, 0); assert.equal(receipt[0]?.status, 'imported');
		assert.deepEqual(await f.catalog.loadPhoto(CATALOG, entry.photo.id), entry.photo);
		assert.equal((await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots.length, 1);
		assert.deepEqual(await f.settings.settingsRepository.readEntry(photoImportIntentKeyV1(CATALOG)), { present: false });
	});
});
