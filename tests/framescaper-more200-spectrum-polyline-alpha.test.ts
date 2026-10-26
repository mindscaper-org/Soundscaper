/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { materializeUnifiedExactRenderVisualEntryV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';

for (const alpha of [64, 128, 255]) test(`a spectrum polyline paints its authored alpha ${alpha} once at each shared vertex`, async () => {
	const rendered = await render(alpha);
	// Silence gives one horizontal path at the spectrum floor. Column zero is
	// intentionally occupied by the independent opaque playback marker.
	for (let x = 1; x < rendered.width; x++) {
		const offset = ((rendered.height - 1) * rendered.width + x) * 4;
		assert.deepEqual(Array.from(rendered.pixels.subarray(offset, offset + 4)), [255, 255, 255, alpha],
			`shared polyline vertex ${x} must retain the authored coverage`);
	}
	assert.equal(rendered.pixels[(10 * rendered.width + 10) * 4 + 3], 0, 'unpainted transparent background stays transparent');
});

for (const backgroundAlpha of [0, 96]) test(`steep adjacent spectrum segments paint each pixel once over alpha ${backgroundAlpha}`, async () => {
	const channels = [Float32Array.from({ length: 1024 }, (_, index) => .4 * Math.sin(2 * Math.PI * 53 * index / 1024))];
	const opaque = await render(255, channels);
	assert.equal(createHash('sha256').update(opaque.pixels).digest('hex'),
		'a799612e2dcbe2a8b615081652870586a4e0f14aa67c5e1f961e18c73fc8e094', 'retain the original opaque path geometry');
	const translucent = await render(128, channels, backgroundAlpha);
	let covered = 0;
	for (let y = 0; y < opaque.height; y++) for (let x = 1; x < opaque.width; x++) {
		const offset = (y * opaque.width + x) * 4;
		const painted = opaque.pixels[offset + 3] === 255;
		if (painted) covered++;
		assert.equal(translucent.pixels[offset + 3], painted
			? Math.round(128 + backgroundAlpha * (1 - 128 / 255)) : backgroundAlpha,
			`pixel ${x},${y} must keep the original path coverage with one alpha blend`);
	}
	assert.ok(covered > opaque.width, 'the independent PCM stimulus produces steep segments spanning several rows');
});

async function render(alpha: number, channels = [new Float32Array(1024)], backgroundAlpha = 0) {
	const entry: UnifiedExactRenderVisualFrameEntryV13 = {
		nodeId: 'visual:visualizer', modelId: 'visualizer-clip', modelKind: 'sound-visualizer',
		trackId: 'pictures', opacity: 1, blendMode: 'normal', masks: [], authoredState: {
			source: { schemaVersion: 1, kind: 'generator', id: 'visualizer-source', name: 'Spectrum',
				width: 32, height: 24, frameRate: { num: 30, den: 1 }, frameCount: 30,
				generator: { kind: 'sound-visualizer', mode: 'spectrum', sourceIds: [], windowSeconds: 1,
					foregroundColor: `#ffffff${alpha.toString(16).padStart(2, '0')}`,
					backgroundColor: `#000000${backgroundAlpha.toString(16).padStart(2, '0')}` } },
			clip: { schemaVersion: 1, kind: 'generator', id: 'visualizer-clip', sourceId: 'visualizer-source',
				sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 },
		},
	};
	return materializeUnifiedExactRenderVisualEntryV13(entry, { targetWidth: 32, targetHeight: 24,
		soundVisualizer: { channels, sampleRate: 48_000, windowStartFrame: 0, timelineFrame: 0 } });
}
