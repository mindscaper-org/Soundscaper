/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';

for (const shape of ['rectangle', 'ellipse'] as const) {
	for (const [fillColor, strokeColor, expected] of [
		['#00ff00ff', '#ff000080', [188, 187, 0, 255]],
		['#00ff0080', '#ff000080', [213, 156, 0, 192]],
		['#00ff00ff', '#ff000000', [0, 255, 0, 255]],
		['#00ff0080', '#ff0000ff', [255, 0, 0, 255]],
		[null, '#ff000080', [255, 0, 0, 128]],
	] as const) {
		test(`${shape} paints ${strokeColor} over its ${fillColor ?? 'absent'} fill`, async () => {
			const frame = await materializeUnifiedExactRenderVisualEntryV13({
				nodeId: 'visual:shape', modelId: 'shape', modelKind: 'shape', trackId: 'pictures',
				authoredState: {
					source: { schemaVersion: 1, kind: 'generator', id: 'source', name: 'Shape', width: 1920, height: 1080,
						frameRate: { num: 30, den: 1 }, frameCount: 30,
						generator: { kind: 'shape', shape, fillColor, strokeColor, strokeWidth: 12 } },
					clip: { schemaVersion: 1, kind: 'generator', id: 'shape', sourceId: 'source', sequenceId: 'main',
						sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 },
				}, opacity: 1, blendMode: 'normal', masks: [],
			}, { targetWidth: 320, targetHeight: 180 });
			// The left outline covers the fill: linear-light source-over retains the lower paint.
			const offset = (90 * frame.width + 40) * 4;
			assert.deepEqual([...frame.pixels.subarray(offset, offset + 4)], expected);
		});
	}
}
