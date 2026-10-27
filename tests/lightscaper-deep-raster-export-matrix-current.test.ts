/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImageExportSizingV1 } from '../src/common/editor/imaging/image-export-size-v1.ts';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { encodePhotoPngCurrentV1 } from '../src/lightscaper/controller/photo-png-export-encoder-current-v1.ts';
import { recoveryRasterFixture } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { nativeRasterReference, targetRasterReference, inspectRasterPng, type RasterTarget } from './helpers/lightscaper-p3-raster-reference-current.ts';

// Three newly active output groups complete the existing twenty JPEG/PNG8
// format-size-scope cells. Quality and watermark choices have separate owners.
const TARGETS: readonly RasterTarget[] = [
	{ profile: 'srgb', bitDepth: 16 }, { profile: 'display-p3', bitDepth: 8 }, { profile: 'display-p3', bitDepth: 16 },
];
// Literal dimensions for this authenticated 128x96 Original. Expectations do
// not call the production size planner, renderer, resampler or color converter.
const SIZES: readonly Readonly<{ sizing: ImageExportSizingV1; width: number; height: number }>[] = [
	{ sizing: { kind: 'original' }, width: 128, height: 96 },
	{ sizing: { kind: 'fit', width: 64, height: 80, allowUpscale: false }, width: 64, height: 48 },
	{ sizing: { kind: 'long-edge', pixels: 96, allowUpscale: false }, width: 96, height: 72 },
	{ sizing: { kind: 'megapixels', megapixels: .003072, allowUpscale: false }, width: 64, height: 48 },
	{ sizing: { kind: 'percentage', percentage: 25 }, width: 32, height: 24 },
];

test('Current native RAW export completes all thirty deep/profile sizing and metadata core cells without changing saved facts', { timeout: 180_000 }, async context => {
	const f = await recoveryRasterFixture(), roles: string[] = [];
	try {
		assert.equal(f.saved.develop.processVersion, 4); assert.equal(f.floats.length, 128 * 96 * 4);
		assert.ok(f.floats.some((value, index) => index % 4 !== 3 && value > 1));
		assert.ok(f.metadata.extracted?.exif);
		for (const target of TARGETS) for (const size of SIZES) {
			const native = nativeRasterReference(f.floats, 128, 96, size.width, size.height, 'nearest');
			const expected = targetRasterReference(native, target), payloads: Buffer[] = [];
			if (target.bitDepth === 16) assert.ok(expected.some((value, index) => index % 4 !== 3 && value % 257 !== 0));
			for (const metadataScope of ['strip', 'capture'] as const) {
				const role = `PNG/${target.profile}/${String(target.bitDepth)}/${size.sizing.kind}/${metadataScope}`;
				await context.test(role, async () => {
					const owner = new PhotoRasterExportCurrentV1('png'), count = f.deliveries.length;
					try {
						const receipt = await owner.start({ ...f.request,
							output: { schemaVersion: 3, ...target, sizing: size.sizing, quality: 'nearest', metadataScope },
							readMetadata: async (photoId, revision, options) => {
								const snapshot = await f.session.readMetadata(photoId, options); assert.equal(snapshot.revision, revision);
								return { catalogId: f.saved.catalogId, snapshot };
							},
							encode: async (frame, options) => {
								assert.equal(frame.descriptor.sampleFormat, 'float32'); assert.equal(frame.descriptor.transfer, 'linear');
								assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [size.width, size.height]);
								assert.deepEqual(frame.pixels, native); assert.equal(options.profile, target.profile); assert.equal(options.bitDepth, target.bitDepth);
								const bytes = await encodePhotoPngCurrentV1(frame, options); f.encoded.push(bytes); return bytes;
							} });
						assert.ok(receipt.status !== 'cancelled'); assert.equal(receipt.status, 'download-started'); assert.deepEqual([receipt.width, receipt.height], [size.width, size.height]);
						assert.equal(f.deliveries.length, count + 1); const delivered = f.deliveries[count]!;
						assert.equal(delivered.mimeType, 'image/png'); assert.equal(receipt.fileName, delivered.name); assert.equal(receipt.byteLength, delivered.bytes.length);
						const inspected = inspectRasterPng(delivered.bytes, size.width, size.height, target, metadataScope === 'capture', expected);
						const sourceExif = f.metadata.extracted?.exif; assert.ok(sourceExif);
						assert.deepEqual(inspected.captureFacts, metadataScope === 'capture' ? {
							cameraMake: sourceExif.cameraMake, cameraModel: sourceExif.cameraModel, lensModel: sourceExif.lensModel } : null);
						payloads.push(inspected.payload);
						assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId }), f.saved);
						assert.deepEqual(await f.session.readMetadata(f.saved.photoId), f.metadata);
						roles.push(role);
					} finally { await owner.cancelAndJoin(); }
				});
			}
			assert.equal(payloads.length, 2); assert.deepEqual(payloads[0], payloads[1], 'Capture must not change color declarations or encoded pixel payload.');
		}
		assert.equal(roles.length, 30); assert.equal(new Set(roles).size, 30); assert.equal(f.deliveries.length, 30);
		await f.assertCustody();
	} finally { await f.close(); }
});
