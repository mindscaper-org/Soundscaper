/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { VideoGeneratorDocumentV1 } from '../src/common/editor/video-visual-model-v24.ts';

for (const shape of ['rectangle', 'ellipse', 'line'] as const) {
	test(`a zero-width ${shape} stroke matches no stroke without losing its fill`, async () => {
		const without = await render(shape, null, 0);
		const zero = await render(shape, '#ffffffff', 0);
		assert.equal(pixelsOf(zero, [255, 255, 255, 255]), 0, 'zero-width outlines must not paint white pixels');
		assert.deepEqual(zero, without, 'zero width must not paint the authored outline color');
		const positive = await render(shape, '#ffffffff', 12);
		assert.notDeepEqual(positive, without, 'a positive outline remains visible');
		assert.ok(pixelsOf(positive, [255, 255, 255, 255]) > 0);
		if (shape !== 'line') assert.ok(pixelsOf(zero, [0, 255, 0, 255]) > 0, 'retain the fill');
	});
}

async function render(shape: 'rectangle' | 'ellipse' | 'line', strokeColor: string | null, strokeWidth: number) {
	const generator: VideoGeneratorDocumentV1 = { kind: 'shape', shape, fillColor: '#00ff00ff', strokeColor, strokeWidth };
	return materializeUnifiedExactRenderVisualEntryV13({
		nodeId: 'visual:shape', modelId: 'shape', modelKind: 'shape', trackId: 'pictures',
		authoredState: {
			source: { schemaVersion: 1, kind: 'generator', id: 'source', name: 'Shape', width: 1920, height: 1080,
				frameRate: { num: 30, den: 1 }, frameCount: 30, generator },
			clip: { schemaVersion: 1, kind: 'generator', id: 'shape', sourceId: 'source', sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 },
		}, opacity: 1, blendMode: 'normal', masks: [],
	}, { targetWidth: 320, targetHeight: 180 });
}

function pixelsOf(frame: Awaited<ReturnType<typeof render>>, color: readonly number[]): number {
	let count = 0;
	for (let offset = 0; offset < frame.pixels.length; offset += 4) {
		if (color.every((value, channel) => frame.pixels[offset + channel] === value)) count++;
	}
	return count;
}
