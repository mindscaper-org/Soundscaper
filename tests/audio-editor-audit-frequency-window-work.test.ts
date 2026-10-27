/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { FrequencyWaveformBandSplitter, generateFrequencyWaveformWindowWithFft } from '../src/common/editor/frequency-waveform-analysis.ts';
import { fft, initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

test('detailed frequency windows retain exact bands and centroids without a discarded band pyramid', () => {
	const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 16_401 }, (_, frame) =>
		Math.sin(frame * (0.031 + channel * 0.1)) * 0.5));
	const accumulate = FrequencyWaveformBandSplitter.prototype.accumulatePeaks;
	let discardedFrames = 0;
	FrequencyWaveformBandSplitter.prototype.accumulatePeaks = function (...args) {
		discardedFrames += args[0][0]!.length; return accumulate.apply(this, args);
	};
	const hashes: string[] = [];
	try {
		for (const sourceStartFrame of [0, 17]) {
			const result = generateFrequencyWaveformWindowWithFft(channels, 48_000,
				{ sourceStartFrame, visibleStartOffset: 1_000, visibleFrameCount: 12_000,
					crossovers: { lowMidHz: 220, midHighHz: 3_800 } }, fft);
			const hash = createHash('sha256');
			for (const band of ['low', 'mid', 'high'] as const) for (const samples of result.bands[band]) {
				hash.update(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
			}
			for (const samples of [result.centroid.numerators, result.centroid.weights]) hash.update(new Uint8Array(samples.buffer));
			hashes.push(hash.digest('hex'));
		}
	} finally { FrequencyWaveformBandSplitter.prototype.accumulatePeaks = accumulate; }
	assert.deepEqual(hashes, ['36545bce8ece07dbd11f1cd03def48c98a2371981b26f732a2df90f1b11acff5', '836603cd342e75bfa1124914b40012cc86179117c77c6a356255650554bb4e3e']);
	assert.equal(discardedFrames, 0);
});
