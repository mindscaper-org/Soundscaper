/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';

function entry(width: number, height: number): UnifiedExactRenderVisualFrameEntryV13 {
	return { nodeId: 'plate-node', modelId: 'frozen', modelKind: 'still', trackId: 'pictures',
		authoredState: { source: { schemaVersion: 1, kind: 'still', id: 'plate', name: 'Frozen detail',
			mimeType: 'image/png', storageKey: 'plate.png', contentSha256: 'ab'.repeat(32), width, height, hasAlpha: true },
		clip: { schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'plate', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30 } },
		opacity: 1, blendMode: 'normal', masks: [] };
}

for (const [width, height] of [[3, 1], [1, 3], [3, 3]] as const) test(`a ${width}×${height} frozen image reduction samples its centre pixel`, async () => {
	const pixels = new Uint8Array(width * height * 4);
	for (let index = 0; index < width * height; index++) pixels[index * 4 + 3] = 255;
	pixels.fill(255, Math.floor(width * height / 2) * 4, Math.floor(width * height / 2) * 4 + 4);
	const result = await materializeUnifiedExactRenderVisualEntryV13(entry(width, height), {
		targetWidth: 1, targetHeight: 1, decodeStill: () => Promise.resolve({ width, height, pixels }) });
	assert.deepEqual(result.pixels, Uint8Array.of(255, 255, 255, 255));
});

test('noninteger frozen-image reduction keeps the centred nearest source locations', async () => {
	const pixels = Uint8Array.from([0, 50, 100, 150, 200].flatMap(value => [value, value, value, 255]));
	const result = await materializeUnifiedExactRenderVisualEntryV13(entry(5, 1), {
		targetWidth: 2, targetHeight: 1, decodeStill: () => Promise.resolve({ width: 5, height: 1, pixels }) });
	assert.deepEqual(result.pixels, Uint8Array.of(50, 50, 50, 255, 150, 150, 150, 255));
});

test('an unscaled frozen image retains all bytes in a detached output', async () => {
	const pixels = Uint8Array.of(11, 22, 33, 44);
	const result = await materializeUnifiedExactRenderVisualEntryV13(entry(1, 1), {
		targetWidth: 1, targetHeight: 1, decodeStill: () => Promise.resolve({ width: 1, height: 1, pixels }) });
	assert.deepEqual(result.pixels, pixels); assert.notEqual(result.pixels, pixels);
});

for (const kind of ['alpha', 'raster'] as const) test(`a reduced ${kind} matte samples the same source pixel centre as its picture`, () => {
	const graph = { schemaVersion: 1, id: 'matte', kind: 'mask',
		inputs: [{ name: 'Plate', sourceRef: 'plate', kind }], outputNodeId: 'coverage',
		nodes: [{ id: 'coverage', kind, inputName: 'Plate', ...(kind === 'raster' ? { channel: 'red' } : {}) }] };
	const pixels = Uint8Array.of(0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0);
	assert.deepEqual(evaluateVideoMaskMatteRgbaV13(graph, 1, 1, new Map([['plate', { width: 3, height: 1, pixels }]])), Uint8Array.of(255));
});
