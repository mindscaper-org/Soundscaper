/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { importManagedPhotosCurrentV1 } from '../src/lightscaper/import/managed-import-current-v1.ts';
import { recoverManagedPhotoImportCurrentV1 as recover } from '../src/lightscaper/import/photo-import-recovery-current-v1.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { managedMediaIntegrationFixtureCurrentV1 as fixture, MANAGED_MEDIA_CATALOG_CURRENT_V1 as CATALOG,
	managedMediaIntegrationIntentCurrentV1 as intent, managedMediaIntegrationReferenceCurrentV1 as reference,
	managedMediaIntegrationReadCurrentV1 as read, managedMediaIntegrationExactFailureCurrentV1 as exactFailure,
	type ManagedMediaIntegrationOwnersCurrentV1 as Owners } from './helpers/lightscaper-native-managed-media-integration-fixture-current.ts';
import { managedMediaIntegrationInputsCurrentV1 as inputs } from './helpers/lightscaper-native-managed-media-integration-fixture-inputs-current.ts';

type Entry = Awaited<ReturnType<typeof inputs>>['entries'][number];
async function stage(owner: Owners, entry: Entry, importId: string) {
	await intent(owner, importId);
	await owner.media.writeAsset(entry.photo.original.storageKey, entry.original, { name: entry.photo.original.name, mimeType: entry.photo.original.mimeType });
	await owner.media.catalogOriginals.stage(CATALOG, importId, [reference(entry.photo.original, entry.photo.id)]);
	const page = await owner.media.catalogOriginals.readPage({ catalogId: CATALOG, importId });
	assert.equal(page.roots.length, 1); return page.roots[0]!;
}

test('Lightscaper actual Current post-ACK cancellation retains published staged custody and intent until real reopened recovery promotes it', async () => {
	await fixture(async f => {
		const data = await inputs(); await data.install(f); const entry = data.entries[3], cancel = new AbortController();
		let traps = 0, observed = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque cancellation get'); }, getPrototypeOf() { traps++; throw Error('Opaque cancellation prototype'); } });
		const importing = importManagedPhotosCurrentV1(CATALOG, [{ photo: entry.photo, original: entry.original }], f.ports,
			{ signal: cancel.signal, onPublished(receipt) { observed++; assert.equal(receipt.status, 'imported'); cancel.abort(reason); } });
		await exactFailure(importing, reason); assert.equal(observed, 1); assert.equal(traps, 0);
		assert.deepEqual(await f.catalog.loadPhoto(CATALOG, entry.photo.id), entry.photo);
		const pending = normalizePhotoImportIntentV1(await f.settings.settingsRepository.get(photoImportIntentKeyV1(CATALOG)), CATALOG);
		const staged = await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: pending.importId });
		assert.equal(staged.roots.length, 1); assert.equal(staged.roots[0]?.photoId, entry.photo.id);
		assert.deepEqual((await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots, []);
		await f.media.verifyOriginal(entry.photo.original); assert.deepEqual(await read(f.media, entry.photo.original), entry.bytes);
		await f.close(); const reopened = await f.reopen(); await recover(CATALOG, reopened.ports);
		const permanent = await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null });
		assert.equal(permanent.roots.length, 1); assert.equal(permanent.roots[0]?.mediaContentToken, staged.roots[0]?.mediaContentToken);
		assert.deepEqual((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: pending.importId })).roots, []);
		assert.deepEqual(await reopened.settings.settingsRepository.readEntry(photoImportIntentKeyV1(CATALOG)), { present: false });
		assert.deepEqual(await reopened.catalog.loadPhoto(CATALOG, entry.photo.id), entry.photo);
		assert.deepEqual(await read(reopened.media, entry.photo.original), entry.bytes); await recover(CATALOG, reopened.ports);
		assert.equal((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots.length, 1);
	});
});

test('Lightscaper real recovery releases a staged missing Photo and allows atomic metadata/binding deletion and recreation', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0], before = await stage(f, entry, 'interrupted-before-photo');
		await f.close(); const reopened = await f.reopen(); await recover(CATALOG, reopened.ports);
		assert.equal(await reopened.catalog.loadPhoto(CATALOG, entry.photo.id), null);
		assert.deepEqual((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: 'interrupted-before-photo' })).roots, []);
		assert.deepEqual(await reopened.settings.settingsRepository.readEntry(photoImportIntentKeyV1(CATALOG)), { present: false });
		assert.ok(await reopened.media.getAssetMetadata(entry.photo.original.storageKey)); await reopened.media.deleteAsset(entry.photo.original.storageKey);
		assert.equal(await reopened.media.getAssetMetadata(entry.photo.original.storageKey), null); await assert.rejects(reopened.media.verifyOriginal(entry.photo.original));
		await reopened.media.writeAsset(entry.photo.original.storageKey, entry.original, { name: entry.photo.original.name, mimeType: entry.photo.original.mimeType });
		await reopened.media.catalogOriginals.retain(CATALOG, [reference(entry.photo.original, entry.photo.id)]);
		const current = (await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots[0]!;
		assert.notEqual(current.mediaContentToken, before.mediaContentToken); assert.deepEqual(await read(reopened.media, entry.photo.original), entry.bytes);
	});
});

test('Lightscaper interrupted real stage before publication is recovered before the next Current import reserves a fresh intent', async () => {
	await fixture(async f => {
		const data = await inputs(), first = data.entries[0], second = data.entries[1]; await stage(f, first, 'earlier-import');
		await f.close(); const reopened = await f.reopen();
		const result = await importManagedPhotosCurrentV1(CATALOG, [{ photo: second.photo, original: second.original }], reopened.ports);
		assert.equal(result[0]?.status, 'imported'); assert.equal(result[0]?.reusedOriginal, true);
		assert.equal(await reopened.catalog.loadPhoto(CATALOG, first.photo.id), null);
		const stored = await reopened.catalog.loadPhoto(CATALOG, second.photo.id); assert.ok(stored); assert.equal(stored.original.storageKey, first.photo.original.storageKey);
		assert.deepEqual((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: 'earlier-import' })).roots, []);
		const permanent = await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null });
		assert.deepEqual(permanent.roots.map(root => root.photoId), [second.photo.id]);
		assert.deepEqual(await reopened.settings.settingsRepository.readEntry(photoImportIntentKeyV1(CATALOG)), { present: false });
	});
});

test('Lightscaper genuine conflicting published Photo refuses staged-root recovery without retiring the protecting intent', async () => {
	await fixture(async f => {
		const entry = (await inputs()).entries[0], root = await stage(f, entry, 'conflicting-photo');
		const conflicting = normalizePhotoDocumentCurrentV1({ ...entry.photo, original: { ...entry.photo.original, id: 'different-source' } });
		await f.catalog.publishPhotos(CATALOG, 0, [conflicting]); await f.close(); const reopened = await f.reopen();
		await assert.rejects(recover(CATALOG, reopened.ports), /conflicting original reference/u);
		assert.deepEqual((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: 'conflicting-photo' })).roots, [root]);
		assert.deepEqual((await reopened.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots, []);
		assert.equal(normalizePhotoImportIntentV1(await reopened.settings.settingsRepository.get(photoImportIntentKeyV1(CATALOG)), CATALOG).importId, 'conflicting-photo');
		assert.deepEqual(await reopened.catalog.loadPhoto(CATALOG, conflicting.id), conflicting);
	});
});

test('Lightscaper genuine missing unused retained brush refuses recovery of an actual published Current Photo3', async () => {
	await fixture(async f => {
		const data = await inputs(); await data.install(f); const entry = data.entries[3], root = await stage(f, entry, 'resource-recovery');
		await f.catalog.publishPhotos(CATALOG, 0, [entry.photo]);
		const database = new DatabaseSync(f.resourceDatabasePath);
		try { database.prepare('DELETE FROM native_photo_resources WHERE storage_key=?').run(data.bundles[5]!.brushes[1]!.reference.storageKey); }
		finally { database.close(); }
		await assert.rejects(recover(CATALOG, f.ports));
		assert.deepEqual((await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: 'resource-recovery' })).roots, [root]);
		assert.deepEqual((await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots, []);
		assert.equal(normalizePhotoImportIntentV1(await f.settings.settingsRepository.get(photoImportIntentKeyV1(CATALOG)), CATALOG).importId, 'resource-recovery');
		assert.deepEqual(await f.catalog.loadPhoto(CATALOG, entry.photo.id), entry.photo);
	});
});
