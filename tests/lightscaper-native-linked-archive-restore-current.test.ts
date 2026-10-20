/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { nativeArchiveRestoreTargetCurrentV1 as target } from './helpers/lightscaper-native-library-archive-restore-fixture-current.ts';
import { scopeAppDataCurrentV1, scopeLibraryRootCurrentV1 } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';
import { nativeLinkedPortableArchiveCurrentV1 as archive, readNativeLinkedPortableArchiveCurrentV1 as read,
	exportNativeLinkedPortableArchiveCurrentV1 as backup, linkedArchiveJsonShaCurrentV1 as sha,
	nativeLinkedArchiveBlobShaCurrentV1 as blobSha } from './helpers/lightscaper-native-linked-archive-restore-fixture-current.ts';

void test('Native portable linked archive restores declared managed copies, exact closure, edits and selected reopen', { concurrency: false, timeout: 15_000 }, async context => {
	const source = await archive(context), originalSha = await blobSha(source.blob, context.signal);
	const admitted = await read(source.blob, context.signal);
	assert.equal(admitted.photos.length, 2); assert.ok(admitted.photos.every(photo => photo.original.retention === 'linked'));
	assert.notEqual(admitted.photos[0]!.original.storageKey, admitted.photos[1]!.original.storageKey);
	assert.equal(admitted.bodies[0]!.sha256, admitted.bodies[1]!.sha256);
	assert.equal(sha(admitted.photos), sha(source.photos)); assert.ok(admitted.luts > 0); assert.ok(admitted.masks > 0);
	await target(context, async f => {
		let expired = false;
		const timer = setTimeout(() => { expired = true; void f.scopes.close().catch(() => undefined); }, 12_000);
		try {
			const receipt = await f.track(f.scopes.restoreArchive(source.blob, { name: 'Managed copy restore', signal: f.signal }));
			assert.equal(receipt.photoCount, 2); assert.equal(receipt.originalCount, 2); assert.equal(receipt.stackCount, 1); assert.equal(receipt.savedCollectionCount, 1);
			const selected = await f.scopes.openSelected({ name: 'Selected', signal: f.signal }), c = await f.scopes.openComponents(selected.scope, { signal: f.signal });
			try {
				assert.equal(sha(await c.catalog.loadCatalog(source.root.id)), sha(source.root));
				for (const previous of source.photos) {
					const expected = normalizePhotoDocumentCurrentV1({ ...previous, original: { ...previous.original, retention: 'managed' } });
					const photo = await c.catalog.loadPhoto(previous.catalogId, previous.id); assert.ok(photo); assert.equal(sha(photo), sha(expected));
					await verifyPhotoResourcesCurrentV1(photo, c.resources, f.signal);
					await c.originals.withOriginal({ catalogId: photo.catalogId, photoId: photo.id, original: photo.original }, async view => {
						const hash = createHash('sha256');
						for (let offset = 0; offset < photo.original.byteLength; offset += 1024 * 1024) {
							const bytes = await view.read(offset, Math.min(1024 * 1024, photo.original.byteLength - offset)); hash.update(bytes); bytes.fill(0);
						} assert.equal(hash.digest('hex'), previous.original.contentSha256);
					}, { signal: f.signal });
				}
				assert.equal(sha(await c.catalog.loadStack(source.root.id, source.stack.id)), sha(source.stack));
				assert.equal(sha(await c.catalog.loadSmartCollection(source.root.id, source.saved.id)), sha(source.saved));
				assert.equal(sha(await c.catalog.readSmartCollectionState(source.root.id)), sha(source.savedState));
				const preset = await c.settings.settingsRepository.readEntry(photoDevelopPresetsKeyV1(source.root.id));
				assert.equal(preset.present, true); if (preset.present) assert.equal(sha(preset.value), sha(source.preset));
				assert.equal((await c.catalog.readQueryPage(source.root.id)).items.length, 2); assert.equal((await c.catalog.readQueryPageV2(source.root.id)).items.length, 2);
				const allocation = f.scopes.describe(selected.scope); assert.ok(allocation);
				const library = scopeLibraryRootCurrentV1(scopeAppDataCurrentV1(f.directory, allocation.namespaceToken));
				const database = new DatabaseSync(join(library, 'native-photo-originals.sqlite3'), { readOnly: true, allowExtension: false });
				try {
					assert.equal(database.prepare('SELECT count(*) AS n FROM native_photo_linked_original_bindings').get()!.n, 0);
					assert.equal(database.prepare("SELECT count(*) AS n FROM native_photo_media_identities WHERE kind='managed' AND linked_key IS NULL").get()!.n, 2);
					assert.equal(database.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()!.n, 2);
				} finally { database.close(); }
				await assert.rejects(lstat(join(library, 'native-photo-linked-grants.sqlite3')), { code: 'ENOENT' });
				const photo = await c.catalog.loadPhoto(source.root.id, source.photos[0]!.id); assert.ok(photo);
				const edited = await c.catalog.savePhoto(normalizePhotoDocumentCurrentV1({ ...photo,
					metadata: { ...photo.metadata, caption: 'Managed destination edit after restore' } }), photo.revision, { signal: f.signal });
				const lut = await c.resources.cubeLutResources(), masks = await c.resources.maskRasterResources();
				const portable = await backup(context, source.root.id, { catalog: c.catalog, stacks: c.catalog, developPresetSettings: c.settings.settingsRepository,
					lutResources: lut.source, maskRasters: masks.source }, c.originalTickets.transport, f.signal);
				const exported = await read(portable, f.signal);
				assert.ok(exported.photos.every(value => value.original.retention === 'managed'));
				assert.equal(sha(exported.photos.find(value => value.id === edited.id)), sha(edited));
				assert.equal(sha(exported.bodies), sha(admitted.bodies)); assert.equal(sha(exported.stacks), sha(admitted.stacks)); assert.equal(sha(exported.saved), sha(admitted.saved));
				await c.close(); await f.reopen();
				const reopened = await f.scopes.openSelected({ name: 'Reopened', signal: f.signal }); assert.equal(reopened.selectionToken, selected.selectionToken);
				const current = await f.scopes.openComponents(reopened.scope, { signal: f.signal });
				try { assert.equal(sha(await current.catalog.loadPhoto(edited.catalogId, edited.id)), sha(edited)); }
				finally { await current.close(); }
			} finally { await c.close(); }
		} finally { clearTimeout(timer); }
		assert.equal(expired, false);
	});
	assert.equal(await blobSha(source.blob, context.signal), originalSha);
	assert.equal(sha((await read(source.blob, context.signal)).photos), sha(source.photos));
});
