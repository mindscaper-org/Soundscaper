/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSpectrogramPcmTiles } from '../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { createSpectrogramSampleViews } from '../src/common/editor/spectrogram-sample-view.ts';

for (const reversed of [false, true]) for (const offsetFrames of [0, 37]) {
test(`looped spectrogram FFT context retains reverse=${reversed} offset=${offsetFrames} through bounded reads`, async () => {
	const samples = Float32Array.from({ length: 700 }, (_, frame) => frame / 700);
	const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: 0,
		durationFrames: 1280, sourceStartFrame: 20, sourceDurationFrames: 640,
		waveformStartFrame: 0, waveformEndFrame: 1280,
		reversed, inverted: true, gain: 0.73, fadeInFrames: 80, fadeOutFrames: 90,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 640, offsetFrames } } };
	const spans: number[] = [];
	const result = await generateSpectrogramPcmTiles({ clip, width: 128, fftWindowSize: 32,
		maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			const range = projectUnwarpedClipSourceRange(clip, startFrame, endFrame);
			const start = Math.floor(range.startFrame), end = Math.ceil(range.endFrame);
			spans.push(end - start);
			assert.ok(end - start <= 124, 'each source read must retain the existing bound');
			return { startFrame: start, endFrame: end, channels: [samples.slice(start, end)] };
		},
		analyze(view, width, options) {
			return Array.from({ length: options.pixelEnd - options.pixelStart }, (_, offset) => {
				const center = Math.floor((options.pixelStart + offset) * view.length / width);
				return [view.sampleAt(center - 16), view.sampleAt(center), view.sampleAt(center + 15)];
			});
		},
	});
	assert.ok(result);
	assert.ok(spans.length > 1);
	const reference = createSpectrogramSampleViews([samples], clip, {})[0]!;
	for (const [pixel, column] of result.channels[0]!.entries()) {
		for (const [index, relative] of [-16, 0, 15].entries()) {
			assert.ok(Math.abs(column[index]! - reference.sampleAt(pixel * 10 + relative)) < 1e-7,
				`pixel ${pixel}, context ${relative} must match the complete source view`);
		}
	}
});
}

test('an unavailable loop fragment cannot publish a partial spectrogram', async () => {
	let reads = 0;
	const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: 0,
		durationFrames: 1280, sourceStartFrame: 0, sourceDurationFrames: 640,
		waveformStartFrame: 620, waveformEndFrame: 660,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 640, offsetFrames: 0 } } };
	const result = await generateSpectrogramPcmTiles({ clip, width: 4, fftWindowSize: 32, maximumSourceFrames: 128,
		async requestPcmWindow(startFrame, endFrame) {
			reads += 1;
			if (startFrame >= 640) return null;
			return { startFrame, endFrame, channels: [new Float32Array(endFrame - startFrame)] };
		}, analyze: () => [[0]],
	});
	assert.equal(result, null);
	assert.equal(reads, 2);
});
