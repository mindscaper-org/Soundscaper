/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperNativePhotoLibraryRestoreReadyCurrentV1 as ready,
	consumeLightscaperNativePhotoLibraryRestoreReadyCurrentV1 as consume } from '../desktop/lightscaper-native-photo-library-restore-ready-current-v1.ts';
import { inspectLightscaperNativePhotoLibraryRestoreCandidateCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-library-restore-claim-current-v1.ts';
import { nativeMediaRestoreFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-media-restore-integration-fixture-current.ts';

void test('Native Ready requires joined actual candidate close and genuine sealed child receipts', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); const catalog = await f.catalog.finish(), media = await f.finish();
		assert.throws(() => ready(f.candidate, catalog, media));
		await f.candidate.close();
		assert.throws(() => ready({ ...f.candidate }, catalog, media));
		assert.throws(() => ready(f.candidate, { ...catalog }, media));
		assert.throws(() => ready(f.candidate, catalog, { ...media }));
		const proof = ready(f.candidate, catalog, media), binding = consume(proof, inspect(f.candidate).owner);
		assert.ok(Object.isFrozen(proof)); assert.ok(Object.isFrozen(binding)); assert.ok(Object.isFrozen(binding.receipt));
		assert.equal(binding.receipt.kind, 'native-photo-library-restore-ready'); assert.equal(binding.receipt.photoCount, 3);
		assert.equal(binding.receipt.originalCount, 2); assert.equal(binding.receipt.catalogInventorySha256, catalog.inventorySha256);
		assert.equal(binding.receipt.mediaInventorySha256, media.inventorySha256); assert.equal(binding.receipt.indexRevision, 0);
		assert.equal(binding.manifestSha256, inspect(f.candidate).manifestSha256); binding.assertCurrent();
		assert.throws(() => consume(proof, inspect(f.candidate).owner));
	});
});

void test('Native Ready refuses copied Proxy foreign-owner and replayed capabilities without burning a legitimate proof', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); const catalog = await f.catalog.finish(), media = await f.finish(); await f.candidate.close();
		const proof = ready(f.candidate, catalog, media), owner = inspect(f.candidate).owner;
		let reflected = 0;
		const proxy = new Proxy(proof, { get() { reflected++; throw new Error('Borrowed proof was inspected.'); }, ownKeys() { reflected++; return []; } });
		assert.throws(() => consume(proxy, owner)); assert.throws(() => consume({ ...proof }, owner));
		assert.throws(() => consume(proof, {})); assert.equal(reflected, 0);
		consume(proof, owner); assert.throws(() => consume(proof, owner));
		assert.throws(() => ready(f.candidate, catalog, media), /already|issued|ready/iu);
	});
});

void test('Native Ready becomes unusable when its successfully closed candidate role retires unpublished', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); const catalog = await f.catalog.finish(), media = await f.finish(); await f.candidate.close();
		const proof = ready(f.candidate, catalog, media), owner = inspect(f.candidate).owner;
		f.candidate.retireRole('unpublished'); assert.throws(() => consume(proof, owner));
	});
});
