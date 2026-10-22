/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpectrogramSampleViews } from '../src/common/editor/spectrogram-sample-view.ts';
import { generateSpectrogramPcmTiles } from '../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';

test('spectrogram FFT samples retain the authored envelope in clip-local time and context', () => {
	const clip = { timelineStartFrame: 12, durationFrames: 8, sourceStartFrame: 4, sourceDurationFrames: 16,
		waveformStartFrame: 2, waveformEndFrame: 6, reversed: true, inverted: true, gain: 2,
		envelope: [{ frame: 0, value: .5 }, { frame: 4, value: 0 }, { frame: 8, value: 1 }] };
	const view = createSpectrogramSampleViews([new Float32Array(24).fill(1)], clip, {})[0]!;
	assert.deepEqual([-2, -1, 0, 1, 2, 3, 4, 5].map(frame => view.sampleAt(frame)), [-1, -.75, -.5, -.25, 0, -.5, -1, -1.5]);
	assert.equal(view.sampleAt(-3), 0);
	assert.equal(view.sampleAt(6), 0);
});

test('bounded real FFT columns stop showing audio silenced by the clip envelope', async () => {
	const samples = Float32Array.from({ length: 640 }, (_, frame) => .2 * Math.sin(2 * Math.PI * frame / 8));
	const result = await generateSpectrogramPcmTiles({
		clip: { id: 'clip', sourceId: 'source', timelineStartFrame: 0, durationFrames: 640,
			sourceStartFrame: 0, sourceDurationFrames: 640, waveformStartFrame: 0, waveformEndFrame: 640,
			envelope: [{ frame: 0, value: 1 }, { frame: 240, value: 0 }, { frame: 640, value: 0 }] },
		width: 64, fftWindowSize: 32, maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			assert.ok(endFrame - startFrame <= 124);
			return { startFrame, endFrame, channels: [samples.slice(startFrame, endFrame)] };
		},
	});
	assert.ok(result);
	assert.ok(Math.max(...result.channels[0]![4]!) > .01);
	assert.ok(result.channels[0]!.slice(30).every(column => column.every(value => value === 0)),
		'late rendered silence must have zero spectral energy, including all FFT context');
});

test('fragmented repeat contexts apply an envelope once without restarting it at the seam', async () => {
	const samples = new Float32Array(640).fill(1);
	const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: 0, durationFrames: 1280,
		sourceStartFrame: 0, sourceDurationFrames: 640, reversed: false, waveformStartFrame: 600, waveformEndFrame: 680,
		envelope: [{ frame: 0, value: .2 }, { frame: 1280, value: 1 }],
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 640, offsetFrames: 0 } } };
	const result = await generateSpectrogramPcmTiles({ clip, width: 8, fftWindowSize: 32, maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			const range = projectUnwarpedClipSourceRange(clip, startFrame, endFrame);
			const start = Math.floor(range.startFrame), end = Math.ceil(range.endFrame);
			return { startFrame: start, endFrame: end, channels: [samples.slice(start, end)] };
		}, analyze(view, width, options) {
			return Array.from({ length: options.pixelEnd - options.pixelStart }, (_, offset) => {
				const center = Math.floor((options.pixelStart + offset) * view.length / width);
				return [view.sampleAt(center - 16), view.sampleAt(center), view.sampleAt(center + 15)];
			});
		},
	});
	assert.ok(result);
	for (const [pixel, column] of result.channels[0]!.entries()) {
		for (const [index, context] of [-16, 0, 15].entries()) {
			const expected = .2 + .8 * (600 + pixel * 10 + context) / 1280;
			assert.ok(Math.abs(column[index]! - expected) < 1e-7, `repeat pixel ${pixel} context ${context}`);
		}
	}
});
