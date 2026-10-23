/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSoundVisualizerRgba } from '../src/common/editor/sound-visualizer-rgba.ts';

for (const [foregroundColor, backgroundColor, expected] of [
	['#ff000080', '#00ff00ff', [188, 187, 0, 255]],
	['#ffffff40', '#000000ff', [137, 137, 137, 255]],
	['#0000ff80', '#ff000060', [142, 0, 222, 176]],
	['#ff0000ff', '#00ff00ff', [255, 0, 0, 255]],
	['#ff000080', '#00000000', [255, 0, 0, 128]],
] as const) test(`visualizer source-over follows the managed linear color authority: ${foregroundColor}/${backgroundColor}`, () => {
	const frame = renderSoundVisualizerRgba({ mode: 'spectrum', channels: [new Float32Array(1024)], sampleRate: 48_000,
		windowStartFrame: 0, timelineFrame: 0, width: 32, height: 24, foregroundColor, backgroundColor });
	const offset = ((frame.height - 1) * frame.width + 16) * 4;
	assert.deepEqual(Array.from(frame.pixels.subarray(offset, offset + 4)), expected,
		'RGBA generator colors are decoded from sRGB, composited in linear Rec709/D65, and re-encoded once');
	const background = Array.from(frame.pixels.subarray((12 * frame.width + 16) * 4, (12 * frame.width + 16) * 4 + 4));
	assert.deepEqual(background, [1, 3, 5, 7].map(start => Number.parseInt(backgroundColor.slice(start, start + 2), 16)),
		'unpainted authored background remains byte-exact');
});

test('the waveform uses the same managed foreground/background composition', () => {
	const frame = renderSoundVisualizerRgba({ mode: 'waveform', channels: [new Float32Array(1024).fill(.5)], sampleRate: 48_000,
		windowStartFrame: 0, timelineFrame: 0, width: 32, height: 24, foregroundColor: '#ff000080', backgroundColor: '#00ff00ff' });
	const offset = (6 * frame.width + 16) * 4;
	assert.deepEqual(Array.from(frame.pixels.subarray(offset, offset + 4)), [188, 187, 0, 255]);
});
