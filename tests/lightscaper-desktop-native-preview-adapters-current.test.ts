/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { BinaryDerivativeCachePortV1 } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { PhotoCullingPreviewCacheCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-cache-current-v1.ts';
import { PhotoHdrPreviewCacheCurrentV1 } from '../src/lightscaper/preview/photo-hdr-preview-cache-current-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { planPhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-plan-current-v1.ts';
import { planPhotoHdrPreviewCurrentV1 } from '../src/lightscaper/preview/photo-hdr-preview-plan-current-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { preparePhotoCullingPreviewCurrentV1 } from '../src/lightscaper/preview/photo-culling-preview-preparation-current-v1.ts';
import { preparePhotoHdrPreviewCurrentV1 } from '../src/lightscaper/preview/photo-hdr-preview-preparation-current-v1.ts';
import { encodeImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { managedMediaIntegrationFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-managed-media-integration-fixture-current.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { verifyNativeMediaCacheCloseCurrentV1 } from './helpers/lightscaper-native-media-cache-close-current.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Media = Parameters<Parameters<typeof fixture>[0]>[0]['media'];
function core(media: Media): BinaryDerivativeCachePortV1 {
	const create: unknown = Reflect.get(media, 'createBinaryDerivativeCache');
	assert.equal(typeof create, 'function', 'Native Media must own the real shared preview cache.');
	return Reflect.apply(create as (...args: unknown[]) => BinaryDerivativeCachePortV1, media, [PHOTO_PREVIEW_CACHE_PROFILE_V1]);
}

void test('Native canonical, camera and HDR cache adapters persist exact prepared bodies through real Media reopen', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		context.signal.throwIfAborted();
		const raw = rawDngFixtureV1().bytes, samples = Float32Array.of(2, .5, 0, 1);
		const hdrDescriptor = { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' } as const;
		const hdr = await encodeImageHdrOriginalV1({ descriptor: hdrDescriptor, pixels: samples }, {
			schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: 0 },
			inputs: [1, .25].map((exposureMultiplier, index) => ({ product: 'lightscaper', ownerId: 'brackets', sourceId: `bracket-${index}`, revision: 0,
				original: { fileName: `${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: sha(raw), byteLength: raw.length, width: 1, height: 1 },
				profile: 'linear-srgb16', exposureMultiplier, offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 1 })),
			output: { x: 0, y: 0, width: 1, height: 1 },
		});
		await f.media.writeAsset('cache-raw', new Blob([raw])); await f.media.writeAsset('cache-hdr', new Blob([hdr]));
		const binding = { catalogId: 'catalog-1', photoId: 'raw-photo', originalId: 'raw-original', storageKey: 'cache-raw',
			contentSha256: sha(raw), byteLength: raw.length, width: 32, height: 32 };
		const frame = { descriptor: { schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const,
			pixels: Uint8Array.from({ length: 32 * 32 * 4 }, (_, index) => index % 256) };
		const canonicalPlan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier: 'thumbnail' });
		const cameraPlan = planPhotoCullingPreviewCurrentV1({ binding, tier: 'thumbnail', source: 'camera-embedded' });
		const hdrBinding = { ...binding, sourceKind: 'hdr-original', photoId: 'hdr-photo', originalId: 'hdr-original', storageKey: 'cache-hdr',
			contentSha256: sha(hdr), byteLength: hdr.length, width: 1, height: 1 };
		const hdrPlan = planPhotoHdrPreviewCurrentV1({ binding: hdrBinding, tier: 'thumbnail' });
		const prepared = [await preparePhotoPreviewV1({ plan: canonicalPlan, binding, frame }),
			await preparePhotoCullingPreviewCurrentV1({ plan: cameraPlan, binding, frame }),
			await preparePhotoHdrPreviewCurrentV1({ plan: hdrPlan, binding: hdrBinding, frame: { descriptor: hdrDescriptor, pixels: samples } })];
		const ports = [new PhotoPreviewCacheV1(core(f.media)), new PhotoCullingPreviewCacheCurrentV1(core(f.media)), new PhotoHdrPreviewCacheCurrentV1(core(f.media))];
		for (let index = 0; index < ports.length; index++) assert.equal((await ports[index]!.store(prepared[index], context.signal)).outcome, 'stored');
		await f.close();
		for (const port of ports) await assert.rejects(port.trim());
		const reopened = await f.reopen(), next = [new PhotoPreviewCacheV1(core(reopened.media)),
			new PhotoCullingPreviewCacheCurrentV1(core(reopened.media)), new PhotoHdrPreviewCacheCurrentV1(core(reopened.media))];
		const plans = [canonicalPlan, cameraPlan, hdrPlan];
		for (let index = 0; index < next.length; index++) {
			const actual = await next[index]!.load(plans[index], context.signal), expected = prepared[index]!; assert.ok(actual);
			assert.equal(actual.key, expected.key); assert.equal(actual.body.size, expected.byteLength);
			assert.equal(sha(new Uint8Array(await actual.body.arrayBuffer())), expected.outputSha256);
		}
		assert.equal(new Set(prepared.map(value => value.key)).size, 3);
	});
});

void test('Native Media close fences cache ports and joins their accepted real Blob read', { timeout: 30_000 }, verifyNativeMediaCacheCloseCurrentV1);
