/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpectrogramSampleViews } from '../src/common/editor/spectrogram-sample-view.ts';
import { pffftSpectrogramBandEnergies, preparePffftSpectrogram } from '../src/common/editor/pffft-spectrogram.js';
import { clipSourceSpectrogramOptions } from '../src/common/editor/ui/inspector/clip-source-spectrogram-options.ts';

for (const sourceRate of [24_000, 48_000, 96_000]) test(`Source Editor frequency labels match projected ${sourceRate}Hz source PCM on its 48k timeline`, async () => {
	const sampleRate = 48_000;
	const source = Float32Array.from({ length: sourceRate }, (_, frame) => .3 * Math.sin(2 * Math.PI * 1000 * frame / sourceRate));
	const views = createSpectrogramSampleViews([source], { timelineStartFrame: 0, durationFrames: sampleRate,
		sourceStartFrame: 0, sourceDurationFrames: source.length, waveformStartFrame: 0, waveformEndFrame: sampleRate },
	{ project: { sampleRate, tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } } });
	await preparePffftSpectrogram(2048);
	const columns = pffftSpectrogramBandEnergies(views[0]!, 4, { fftWindowSize: 2048, frequencyBands: 1024 });
	assert.ok(columns);
	const middle: readonly number[] = columns[2]!;
	const peak = middle.indexOf(Math.max(...middle));
	const options = clipSourceSpectrogramOptions(sampleRate, sourceRate);
	const displayedFrequency = (peak + .5) * options.sampleRate / 2 / middle.length;
	assert.ok(Math.abs(displayedFrequency - 1000) < 40, `painted frequency ${displayedFrequency}Hz differs from the source tone`);
	assert.equal(options.maxFreq, Math.min(sampleRate, sourceRate) / 2);
});
