/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { placeUnifiedExactLinearRgbaFrameV13 } from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { warpApplied } from '../src/common/editor/unified-exact-render-finishing-motion-v13.ts';

for (const opacity of [1, 0.5]) test(`scaled PNG edges filter premultiplied color before applying opacity${opacity}`, () => {
	const placed = placeUnifiedExactLinearRgbaFrameV13({
		frame: { width: 2, height: 1, pixels: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0) },
		displayWidth: 2, displayHeight: 1, outputWidth: 4, outputHeight: 1,
		renderDescription: resolveVideoRenderDescription({ composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			sourceDisplaySize: { width: 2, height: 1 }, canvas: { width: 4, height: 1, fit: 'stretch' }, opacityStart: opacity }),
	});
	// At x1, the bilinear weights are 3/4 opaque red plus1/4 transparent black.
	assert.equal(placed.pixels[4], 0.75 * opacity);
	assert.equal(placed.pixels[7], 0.75 * opacity);
	assert.equal(placed.pixels[8], 0.25 * opacity);
	assert.equal(placed.pixels[11], 0.25 * opacity);
});

for (const transparent of [[0, 0, 0], [0, 255, 0]] as const) test(`motion resampling ignores invisible RGB${transparent.join(',')}`, () => {
	const frame = warpApplied({ width: 2, height: 1,
		pixels: Uint8Array.of(255, 0, 0, 255, ...transparent, 0) },
	{ scale: 1, rotationRadians: 0, translateX: 0.5, translateY: 0, inlierCount: 1, meanError: 0 });
	assert.deepEqual([...frame.pixels.subarray(4)], [255, 0, 0, 128]);
});

test('opaque bilinear color interpolation remains unchanged', () => {
	const frame = warpApplied({ width: 2, height: 1, pixels: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255) },
		{ scale: 1, rotationRadians: 0, translateX: 0.5, translateY: 0, inlierCount: 1, meanError: 0 });
	assert.deepEqual([...frame.pixels.subarray(4)], [128, 128, 0, 255]);
});
