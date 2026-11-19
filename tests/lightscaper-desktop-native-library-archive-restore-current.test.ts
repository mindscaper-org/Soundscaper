/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { restoreLightscaperNativePhotoLibraryArchiveCurrentV1 as restore } from '../desktop/lightscaper-native-photo-library-archive-restore-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { createScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import { nativeRestoreArchiveCurrentV1 as archive, nativeArchiveRestoreTargetCurrentV1 as target,
	nativeRestoreJsonShaCurrentV1 as jsonSha } from './helpers/lightscaper-native-library-archive-restore-fixture-current.ts';

for (const presets of [false, true]) void test(`Native whole archive restores actual six-Photo closure, exact recipes and ${presets ? 'physical preset tombstone' : 'absent presets'}`, { timeout: 15_000 }, async context => {
	const source = await archive(context, presets);
	await target(context, async f => {
		const result = await f.track(restore(f.scopes, source.blob, { name: 'Native default', signal: f.signal }));
		assert.equal(result.catalogId, source.root.id); assert.equal(result.photoCount, 6); assert.equal(result.stackCount, 1);
		assert.equal(result.savedCollectionCount, 1); assert.equal(result.originalCount, 3); assert.deepEqual(result.notices, []);
		const selected = await f.scopes.openSelected({ name: 'Ignored after initialization', signal: f.signal });
		const c = await f.scopes.openComponents(selected.scope, { signal: f.signal });
		assert.equal(jsonSha(await c.catalog.loadCatalog(source.root.id)), jsonSha(source.root));
		for (const expected of source.photos) {
			const photo = await c.catalog.loadPhoto(source.root.id, expected.id); assert.ok(photo); assert.equal(jsonSha(photo), jsonSha(expected));
			await verifyPhotoResourcesCurrentV1(photo, c.resources, f.signal);
			await c.originals.withOriginal({ catalogId: photo.catalogId, photoId: photo.id, original: photo.original }, async view => {
				const hash = createHash('sha256');
				for (let offset = 0; offset < photo.original.byteLength; offset += 1024 * 1024) {
					const bytes = await view.read(offset, Math.min(1024 * 1024, photo.original.byteLength - offset)); hash.update(bytes); bytes.fill(0);
				}
				assert.equal(hash.digest('hex'), photo.original.contentSha256);
			}, { signal: f.signal });
		}
		assert.equal(jsonSha(await c.catalog.loadStack(source.root.id, source.stack.id, { signal: f.signal })), jsonSha(source.stack));
		assert.equal((await c.catalog.readStackState(source.root.id, { signal: f.signal })).revision, 0);
		assert.equal(jsonSha(await c.catalog.loadSmartCollection(source.root.id, source.saved.id, { signal: f.signal })), jsonSha(source.saved));
		assert.equal(jsonSha(await c.catalog.readSmartCollectionState(source.root.id, { signal: f.signal })), jsonSha(source.savedState));
		const preset = await c.settings.settingsRepository.readEntry(photoDevelopPresetsKeyV1(source.root.id));
		assert.equal(preset.present, presets); if (preset.present) assert.equal(jsonSha(preset.value), jsonSha(source.presetRow));
		assert.equal((await c.catalog.readQueryPage(source.root.id, { signal: f.signal })).items.length, 6);
		assert.equal((await c.catalog.readQueryPageV2(source.root.id, { signal: f.signal })).items.length, 6);
		await c.close(); await f.reopen();
		const reopened = await f.scopes.openSelected({ name: 'Reopened', signal: f.signal }); assert.equal(reopened.selectionToken, selected.selectionToken);
		const reopenedComponents = await f.scopes.openComponents(reopened.scope, { signal: f.signal });
		assert.equal(jsonSha(await reopenedComponents.catalog.loadCatalog(source.root.id)), jsonSha(source.root)); await reopenedComponents.close();
	});
});

void test('Native restored selection remains reopenable after genuine post-restore Photo edits', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		await f.track(restore(f.scopes, source.blob, { name: 'Native default', signal: f.signal }));
		const selected = await f.scopes.openSelected({ name: 'Selected', signal: f.signal }), c = await f.scopes.openComponents(selected.scope);
		const photo = await c.catalog.loadPhoto(source.root.id, source.photos[0]!.id); assert.ok(photo);
		const changed = await c.catalog.savePhoto(normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, caption: 'A later native edit' } }), photo.revision);
		await c.close(); await f.reopen();
		const reopened = await f.scopes.openSelected({ name: 'Selected', signal: f.signal }), current = await f.scopes.openComponents(reopened.scope);
		assert.equal(jsonSha(await current.catalog.loadPhoto(changed.catalogId, changed.id)), jsonSha(changed)); await current.close();
	});
});

void test('Native corrupt archive leaves the actual selected pointer unchanged and permits a later genuine restore', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		const previous = await f.scopes.openSelected({ name: 'Native default', signal: f.signal });
		await assert.rejects(f.track(restore(f.scopes, new Blob([Uint8Array.of(1, 2, 3)]), { name: 'Native default', signal: f.signal })));
		assert.equal((await f.scopes.openSelected({ name: 'Still selected', signal: f.signal })).selectionToken, previous.selectionToken);
		await f.track(restore(f.scopes, source.blob, { name: 'Native default', signal: f.signal }));
		assert.notEqual((await f.scopes.openSelected({ name: 'New selected', signal: f.signal })).selectionToken, previous.selectionToken);
	});
});

void test('Native whole archive refuses copied and Proxy managers before options reflection or input IO', { timeout: 15_000 }, async context => {
	await target(context, async f => {
		let reads = 0, reflected = 0;
		const input = createScapeArchiveByteSource({ size: 1, read() { reads++; return Uint8Array.of(1); } });
		const options = new Proxy({ name: 'Native default' }, { getOwnPropertyDescriptor() { reflected++; throw new Error('Options were inspected.'); } });
		const proxy = new Proxy(f.scopes, { get() { reflected++; throw new Error('Manager was inspected.'); } });
		await assert.rejects(restore(proxy, input, options));
		await assert.rejects(restore({ ...f.scopes } as typeof f.scopes, input, options));
		assert.equal(reads, 0); assert.equal(reflected, 0); assert.equal((await f.scopes.readAllocationPage()).allocations.length, 0);
	});
});
