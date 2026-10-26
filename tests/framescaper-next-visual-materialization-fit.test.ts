/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import { placeUnifiedExactLinearRgbaFrameV13 } from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { resolveFramescaperVisualPlacementFinishing } from '../src/framescaper/visual-placement-finishing.ts';
import { assetStore, committedProject, drawableFactory, imageFixture, openSession,
	type RecordedDrawableTimelineImage } from './helpers/framescaper-timeline-image-preview-fixture.ts';

const entry: UnifiedExactRenderVisualFrameEntryV13 = {
	nodeId: 'still-node', modelId: 'frozen', modelKind: 'still', trackId: 'pictures',
	authoredState: {
		source: { schemaVersion: 1, kind: 'still', id: 'png', name: 'Frozen detail', mimeType: 'image/png',
			storageKey: 'png', contentSha256: 'ab'.repeat(32), width: 4, height: 12, hasAlpha: false },
		clip: { schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'png', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30 },
	}, opacity: 1, blendMode: 'normal', masks: [],
};

for (const fit of ['cover', 'stretch'] as const) test(`${fit} must preserve image detail before final placement`, async () => {
	const placement = resolveFramescaperVisualPlacementFinishing(entry, { width: 12, height: 4, fit });
	const original = new Uint8Array(4 * 12 * 4);
	for (let y = 0; y < 12; y++) for (let x = 0; x < 4; x++) {
		const offset = (y * 4 + x) * 4;
		original.fill(x === 2 ? 255 : 0, offset, offset + 3); original[offset + 3] = 255;
	}
	const materialized = await materializeUnifiedExactRenderVisualEntryV13(entry, {
		targetWidth: placement.width, targetHeight: placement.height,
		decodeStill: () => Promise.resolve({ width: 4, height: 12, pixels: original }),
	});
	const output = placeUnifiedExactLinearRgbaFrameV13({ frame: materialized,
		displayWidth: placement.width, displayHeight: placement.height,
		outputWidth: 12, outputHeight: 4, renderDescription: placement.renderDescription });
	assert.ok(output.pixels.some((value, index) => index % 4 === 0 && value > 0.9),
		'a representable white source stripe must not disappear into a pre-contain raster');
	assert.equal(placement.width, 4); assert.equal(placement.height, 12);
});

test('contain retains bounded downscaling and never enlarges the source raster', () => {
	const placement = resolveFramescaperVisualPlacementFinishing(entry, { width: 12, height: 4, fit: 'contain' });
	assert.equal(placement.width, 1); assert.equal(placement.height, 4);
	const larger = resolveFramescaperVisualPlacementFinishing(entry, { width: 48, height: 144, fit: 'cover' });
	assert.equal(larger.width, 4); assert.equal(larger.height, 12);
});

for (const fit of ['cover', 'stretch'] as const) test(`native image preview prepares enough pixels for ${fit}`, async () => {
	const fixture = imageFixture('portrait', 4, 12, 1);
	const drawables: RecordedDrawableTimelineImage[] = [];
	const session = await openSession({ project: committedProject(fixture), store: assetStore([fixture]),
		width: 12, height: 4, fit, createImageDrawable: drawableFactory(drawables) });
	try {
		assert.equal(drawables[0]?.request.width, 4);
		assert.equal(drawables[0]?.request.height, 12);
	} finally { session.dispose(); }
});
