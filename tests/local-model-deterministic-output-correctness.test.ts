/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSpeechFixture, prepareModelInput } from './electron/local-assistance-models/model-inputs.js';
import { ModelFixtureMismatchError } from './electron/local-assistance-models/model-fixture-semantics.ts';
import { validateModelOutput } from './electron/local-assistance-models/model-output-validation.js';

const text = 'And so my fellow Americans ask not what your country can do for you ask what you can do for your country';
const expectedTranscript = { text, maximumWordErrorRate: 0.05 };
const speech = { bytes: Buffer.from('source'), sampleRate: 16_000, frameCount: 208_000, expectedTranscript };
const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const transcript = (words: string): Buffer => json({ segments: [{ text: words, startSeconds: 1, endSeconds: 12 }] });

interface TranscriptCheck {
	readonly transcript: { readonly expectedWords: readonly string[]; readonly recognizedWords: readonly string[];
		readonly substitutions: number; readonly deletions: number; readonly insertions: number;
		readonly wordEdits: number; readonly wordErrorRate: number; readonly maximumWordErrorRate: number };
}

test('known speech rejects random readable words and reports the observed word errors', () => {
	assert.throws(() => validateModelOutput('transcript', transcript('some real words'), speech), /JFK.*word/u);
	assert.throws(() => validateModelOutput('transcript', transcript(text.replace('fellow Americans', 'random strangers')), speech),
		(error: unknown) => {
			assert.ok(error instanceof ModelFixtureMismatchError);
			const summary = error.summary as unknown as TranscriptCheck;
			assert.equal(summary.transcript.substitutions, 2);
			assert.equal(summary.transcript.wordEdits, 2);
			assert.equal(summary.transcript.wordErrorRate, 2 / 22);
			assert.ok(summary.transcript.recognizedWords.includes('strangers'));
			return true;
		});
});

test('known speech joins segments, ignores case and punctuation, and permits at most one word edit', () => {
	const exact = validateModelOutput('transcript', json({ segments: [
		{ text: 'AND SO, MY FELLOW AMERICANS:', startSeconds: 1, endSeconds: 4 },
		{ text: 'ask not what your country can do for you. Ask what you can do for your country!', startSeconds: 4, endSeconds: 12 },
	] }), speech) as TranscriptCheck;
	assert.equal(exact.transcript.expectedWords.length, 22);
	assert.equal(exact.transcript.wordEdits, 0);
	assert.equal(exact.transcript.wordErrorRate, 0);
	for (const [observed, metric] of [
		[text.replace('Americans', 'listeners'), 'substitutions'],
		[text.replace('fellow ', ''), 'deletions'],
		[`${text} today`, 'insertions'],
	] as const) {
		const result = validateModelOutput('transcript', transcript(observed), speech) as TranscriptCheck;
		assert.equal(result.transcript[metric], 1);
		assert.equal(result.transcript.wordEdits, 1);
		assert.equal(result.transcript.wordErrorRate, 1 / 22);
	}
	assert.throws(() => validateModelOutput('transcript', transcript(text), { ...speech, expectedTranscript: undefined }), /expected/u);
	assert.throws(() => validateModelOutput('transcript', transcript(text), {
		...speech, expectedTranscript: { ...expectedTranscript, maximumWordErrorRate: 0.1 },
	}), /five percent/u);
});

const expectedBeatGrid = { count: 32, firstBeatSeconds: 0, intervalSeconds: 0.5,
	maximumTimingErrorSeconds: 0.05, bpm: 120, maximumBpmError: 1 };
const rhythmic = { bytes: Buffer.from('source'), sampleRate: 22_050, frameCount: 352_800, expectedBeatGrid };
const beats = (times: readonly number[], bpm = 120): Buffer => json({ schemaVersion: 1, sampleRate: rhythmic.sampleRate,
	points: times.map((time, index) => ({ sample: Math.round(time * rhythmic.sampleRate),
		kind: index % 4 === 0 ? 'downbeat' : 'beat', confidence: null })), tempoProposal: { kind: 'constant', bpm } });
const grid = Array.from({ length: 32 }, (_, index) => index * 0.5);

interface BeatCheck {
	readonly points: number;
	readonly beatGrid: { readonly expectedPointCount: number; readonly observedPointCount: number;
		readonly maximumObservedTimingErrorSeconds: number; readonly bpmError: number };
}

test('known beats reject shifted, incomplete, extra, and incorrectly paced output', () => {
	for (const bytes of [beats(grid.map(time => time + 0.1)), beats(grid.slice(1)),
		beats([...grid, 15.75]), beats(grid.map(time => time + 0.051)), beats(grid, 121.1)]) {
		assert.throws(() => validateModelOutput('beat-grid', bytes, rhythmic), /rhythmic.*(grid|tempo)/u);
	}
	assert.throws(() => validateModelOutput('beat-grid', beats(grid.map(time => time + 0.1)), rhythmic), (error: unknown) => {
		assert.ok(error instanceof ModelFixtureMismatchError);
		const summary = error.summary as unknown as BeatCheck;
		assert.equal(summary.beatGrid.observedPointCount, 32);
		assert.ok(summary.beatGrid.maximumObservedTimingErrorSeconds >= 0.099);
		return true;
	});
});

test('known beats retain all beat kinds, tolerate quantization, and report timing and tempo errors', () => {
	const result = validateModelOutput('beat-grid', beats(grid.map(time => time + 0.02), 120.5), rhythmic) as BeatCheck;
	assert.equal(result.points, 32);
	assert.equal(result.beatGrid.expectedPointCount, 32);
	assert.ok(Math.abs(result.beatGrid.maximumObservedTimingErrorSeconds - 0.02) < 1e-10);
	assert.equal(result.beatGrid.bpmError, 0.5);
	assert.doesNotThrow(() => validateModelOutput('beat-grid', beats(grid.map(time => time + 0.049), 121), rhythmic));
	assert.throws(() => validateModelOutput('beat-grid', beats(grid), { ...rhythmic, expectedBeatGrid: undefined }), /expected/u);
});

const shotInput = { bytes: Buffer.from('source'), frameCount: 120,
	authority: { timescale: 30, frames: Array.from({ length: 120 }, (_, sourceFrame) => ({ sourceFrame, presentationTick: String(sourceFrame) })) },
	expectedShotBoundaries: { sourceFrame: 60 } };
const shots = (frames: readonly number[]): Buffer => json({ schemaVersion: 1, detector: 'transnetv2', timescale: 30,
	sourceFrameCount: 120, boundaries: frames.map(sourceFrame => ({ sourceFrame, presentationTick: String(sourceFrame), score: 0.97 })) });

test('known shot change accepts only one boundary on either side of the cut convention', () => {
	for (const frame of [59, 60]) {
		const result = validateModelOutput('shot-boundaries', shots([frame]), shotInput) as {
			readonly boundaries: number; readonly shotBoundaries: { readonly recognizedFrames: readonly number[] };
		};
		assert.equal(result.boundaries, 1);
		assert.deepEqual(result.shotBoundaries.recognizedFrames, [frame]);
	}
	for (const frames of [[20], [58], [61], [59, 60]]) {
		assert.throws(() => validateModelOutput('shot-boundaries', shots(frames), shotInput), /shot.*boundary/u);
	}
	assert.throws(() => validateModelOutput('shot-boundaries', shots([59, 60]), shotInput), (error: unknown) => {
		assert.ok(error instanceof ModelFixtureMismatchError);
		assert.deepEqual(error.summary, { boundaries: 2, shotBoundaries: {
			expectedCutFrame: 60, allowedSourceFrames: [59, 60], recognizedFrames: [59, 60],
		} });
		return true;
	});
	assert.throws(() => validateModelOutput('shot-boundaries', shots([60]), {
		...shotInput, expectedShotBoundaries: undefined,
	}), /expected/u);
});

test('prepared speech and rhythmic fixtures carry their known content expectations', async () => {
	const input = await loadSpeechFixture(false);
	assert.ok('expectedTranscript' in input);
	assert.deepEqual(input.expectedTranscript, expectedTranscript);
	const rhythm = await prepareModelInput('rhythmic-music-22050hz');
	assert.ok('expectedBeatGrid' in rhythm);
	assert.deepEqual(rhythm.expectedBeatGrid, expectedBeatGrid);
	assert.equal(rhythm.frameCount / rhythm.sampleRate, 16);
});
