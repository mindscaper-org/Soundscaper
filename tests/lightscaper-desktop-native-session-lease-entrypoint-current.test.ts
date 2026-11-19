/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSessionLeaseFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-session-lease-integration-fixture-current.ts';

void test('Actual native selected Session lease opens after genuine Catalog/Original/Root1/resources publication', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		assert.equal(f.lease.catalogId, f.selected.catalogId); assert.equal(f.lease.selectionToken, f.selected.selectionToken);
		assert.ok(f.lease.signal instanceof AbortSignal); assert.equal(f.lease.signal.aborted, false);
		assert.equal(Object.isFrozen(f.lease), true); assert.equal(Object.isFrozen(f.components), true);
		const root = await f.components.catalog.loadCatalog(f.lease.catalogId); assert.ok(root); assert.equal(root.photoCount, 2);
		const photo = await f.components.catalog.loadPhoto(root.id, f.photos[0]!.id); assert.ok(photo);
		assert.deepEqual(await f.components.media.inspectCatalogOriginalBody({ catalogId: root.id, importId: null, photoId: photo.id,
			assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: photo.original.contentSha256!, size: photo.original.byteLength,
			name: photo.original.name, mimeType: photo.original.mimeType }), { status: 'present' });
		await (await f.components.resources.cubeLutResources()).verifyPhoto(photo);
		await (await f.components.resources.maskRasterResources()).verifyPhoto(photo);
		assert.equal(f.components.close(), f.lease.close(), 'Actual Components close delegates to the same selected lease retirement.');
		await f.lease.close(); assert.equal(f.counts().localCloses, 1);
	});
});
