/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { PhotoCullingPreviewCacheCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-cache-current-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { preparePhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-preparation-current-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { planPhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-plan-current-v1.ts';
import { nativeSessionClientFixtureCurrentV1 as fixture, runtimeShaCurrentV1 as sha } from './helpers/lightscaper-desktop-native-session-client-integration-fixture-current.ts';

void test('Complete protocol desktop Session default HDR codec/scheduler and all three real cache adapters persist authenticated prepared bytes', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = await f.open(), photo = f.photos[2]!;
		const ready = await session.readPreview(photo.id, 'thumbnail'); assert.equal(ready.outcome, 'ready');
		if (ready.outcome !== 'ready') assert.fail('Actual default HDR preview missing.');
		assert.equal(ready.cache, 'stored'); assert.equal(ready.preview.descriptor.width, 32); assert.equal(ready.preview.descriptor.height, 32);
		assert.equal(ready.preview.byteLength, 32 * 32 * 4);
		const pixels = new Uint8Array(await ready.preview.body.arrayBuffer()), expected = new Uint8Array(32 * 32 * 4);
		for (let offset = 0; offset < expected.length; offset += 4) {
			if ((offset / 4) % 2 === 0) { expected[offset] = 255; expected[offset + 1] = 188; } expected[offset + 3] = 255;
		}
		try {
			assert.equal(pixels.byteLength, expected.byteLength); assert.equal(sha(pixels), sha(expected)); assert.equal(sha(pixels), ready.preview.outputSha256);
			const stages = f.storage.events.filter(event => event === 'get-file').length;
			const hit = await session.readPreview(photo.id, 'thumbnail'); assert.equal(hit.outcome, 'ready'); if (hit.outcome === 'ready') assert.equal(hit.cache, 'hit');
			assert.equal(f.storage.events.filter(event => event === 'get-file').length, stages, 'Warm actual HDR cache must avoid a second native Original stage.');
			const core = f.components.media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1), canonical = new PhotoPreviewCacheV1(core), culling = new PhotoCullingPreviewCacheCurrentV1(core);
			const binding = { catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
				contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: photo.original.width, height: photo.original.height };
			// These are the actual display pixels produced above by the default
			// maintained HDR codec, not a decoder-shaped cache fixture. This tests
			// canonical/culling byte adapters; camera RAW decoding remains separate.
			const frame = { descriptor: ready.preview.descriptor, pixels }, plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier: 'thumbnail' });
			const cullingPlan = planPhotoCullingPreviewCurrentV1({ binding, tier: 'thumbnail', source: 'camera-embedded' });
			const plain = await preparePhotoPreviewV1({ binding, plan, frame, signal: context.signal });
			const camera = await preparePhotoCullingPreviewCurrentV1({ binding, plan: cullingPlan, frame, representation: 'neutral-original', signal: context.signal });
			assert.equal((await canonical.store(plain)).outcome, 'stored'); assert.equal((await culling.store(camera)).outcome, 'stored');
			await session.close(); await f.reopen(); const reopened = await f.open();
			const persisted = await reopened.readPreview(photo.id, 'thumbnail'); assert.equal(persisted.outcome, 'ready'); if (persisted.outcome === 'ready') assert.equal(persisted.cache, 'hit');
			const nextCore = f.components.media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1);
			const a = await new PhotoPreviewCacheV1(nextCore).load(plan), b = await new PhotoCullingPreviewCacheCurrentV1(nextCore).load(cullingPlan); assert.ok(a); assert.ok(b);
			assert.equal(a.outputSha256, plain.outputSha256); assert.equal(b.outputSha256, camera.outputSha256); assert.equal(f.storage.counts().stages, 0);
		} finally { pixels.fill(0); expected.fill(0); }
	});
});
