/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';

for (const [width, height] of [[320, 180], [180, 320], [320, 320]] as const) {
	test(`an ellipse retains its positive outline width on both axes at ${width}x${height}`, async () => {
		const frame = await render(width, height, 120);
		const expected = Math.round(120 * width / 1920);
		const white = (x: number, y: number): boolean => frame.pixels[(y * width + x) * 4] === 255;
		const horizontal = Array.from({ length: width / 2 }, (_, x) => x).filter(x => white(x, height / 2)).length;
		const vertical = Array.from({ length: height / 2 }, (_, y) => y).filter(y => white(width / 2, y)).length;
		assert.equal(horizontal, expected, 'left outline width is measured in pixels, not normalized ellipse radius');
		assert.equal(vertical, expected, 'top outline uses the same authored width');
		assert.equal(frame.pixels[((height / 2) * width + width / 2) * 4 + 1], 255, 'retain green fill');
	});
}

test('an outline wider than the ellipse minor radius fills its interior and preserves the outer boundary', async () => {
	const frame = await render(320, 180, 1920);
	assert.deepEqual([...frame.pixels.subarray((90 * 320 + 160) * 4, (90 * 320 + 160) * 4 + 4)], [255, 255, 255, 255]);
	assert.equal(frame.pixels[3], 0);
});

test('ellipse outline distance stays uniform between the axes too', async () => {
	const width = 640, height = 360, frame = await render(width, height, 120);
	const a = (width - 2 * Math.round(width / 8)) / 2, b = (height - 2 * Math.round(height / 8)) / 2;
	for (const degrees of [20, 35, 45, 60, 75]) {
		const angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
		const length = Math.hypot(cosine / a, sine / b), nx = cosine / a / length, ny = sine / b / length;
		for (const [distance, expected] of [[38, 255], [42, 0]] as const) {
			const x = Math.floor(width / 2 + a * cosine - distance * nx);
			const y = Math.floor(height / 2 + b * sine - distance * ny);
			assert.equal(frame.pixels[(y * width + x) * 4], expected, `${degrees}° at ${distance}px inward normal distance`);
		}
	}
});

async function render(width: number, height: number, strokeWidth: number) {
	return await materializeUnifiedExactRenderVisualEntryV13({
		nodeId: 'visual:shape', modelId: 'shape', modelKind: 'shape', trackId: 'pictures',
		authoredState: {
			source: { schemaVersion: 1, kind: 'generator', id: 'source', name: 'Shape', width: 1920, height: 1080,
				frameRate: { num: 30, den: 1 }, frameCount: 30,
				generator: { kind: 'shape', shape: 'ellipse', fillColor: '#00ff00ff', strokeColor: '#ffffffff', strokeWidth } },
			clip: { schemaVersion: 1, kind: 'generator', id: 'shape', sourceId: 'source', sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 },
		}, opacity: 1, blendMode: 'normal', masks: [],
	}, { targetWidth: width, targetHeight: height });
}
