/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { AssistanceBeatGridV1 } from '../../../src/common/editor/assistance/m7-semantic-results.ts';
import type { AssistanceShotBoundariesReviewV1 } from '../../../src/common/editor/assistance/shot-boundaries-v1.ts';
import { ModelFixtureMismatchError } from './model-fixture-semantics.ts';

export const MODEL_JFK_TEXT = 'And so my fellow Americans ask not what your country can do for you ask what you can do for your country';
export const MODEL_TRANSCRIPT_FIXTURE = Object.freeze({ text: MODEL_JFK_TEXT, maximumWordErrorRate: 0.05 });
export const MODEL_BEAT_FIXTURE = Object.freeze({ count: 32, firstBeatSeconds: 0, intervalSeconds: 0.5,
	maximumTimingErrorSeconds: 0.05, bpm: 120, maximumBpmError: 1 });
export const MODEL_SHOT_FIXTURE = Object.freeze({ sourceFrame: 60 });

interface TranscriptExpectation {
	readonly text: string;
	readonly maximumWordErrorRate: number;
}

interface BeatExpectation {
	readonly count: number;
	readonly firstBeatSeconds: number;
	readonly intervalSeconds: number;
	readonly maximumTimingErrorSeconds: number;
	readonly bpm: number;
	readonly maximumBpmError: number;
}

interface ShotExpectation {
	readonly sourceFrame: number;
}

interface WordEdits {
	readonly wordEdits: number;
	readonly substitutions: number;
	readonly deletions: number;
	readonly insertions: number;
}

/** Case and punctuation do not change the known spoken words. */
function words(text: string): string[] {
	return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function wordEdits(expected: readonly string[], observed: readonly string[]): WordEdits {
	let previous: WordEdits[] = Array.from({ length: observed.length + 1 }, (_, insertions) => ({
		wordEdits: insertions, substitutions: 0, deletions: 0, insertions,
	}));
	for (let row = 1; row <= expected.length; row += 1) {
		const current: WordEdits[] = [{ wordEdits: row, substitutions: 0, deletions: row, insertions: 0 }];
		for (let column = 1; column <= observed.length; column += 1) {
			const substitution = expected[row - 1] === observed[column - 1] ? 0 : 1;
			const diagonal = previous[column - 1]!, deletion = previous[column]!, insertion = current[column - 1]!;
			const candidates = [
				{ ...diagonal, wordEdits: diagonal.wordEdits + substitution, substitutions: diagonal.substitutions + substitution },
				{ ...deletion, wordEdits: deletion.wordEdits + 1, deletions: deletion.deletions + 1 },
				{ ...insertion, wordEdits: insertion.wordEdits + 1, insertions: insertion.insertions + 1 },
			];
			current.push(candidates.reduce((best, candidate) => candidate.wordEdits < best.wordEdits ? candidate : best));
		}
		previous = current;
	}
	return previous[observed.length]!;
}

export function validateTranscriptFixtureSemantics(
	result: { readonly segments: readonly { readonly text: string }[] }, expected: TranscriptExpectation | undefined,
) {
	assert.ok(expected && typeof expected.text === 'string' && expected.text.trim(), 'Speech fixture expected text is missing.');
	assert.ok(Number.isFinite(expected.maximumWordErrorRate) && expected.maximumWordErrorRate >= 0
		&& expected.maximumWordErrorRate <= 0.05, 'Speech fixture word error tolerance must be at most five percent.');
	const expectedWords = words(expected.text);
	assert.ok(expectedWords.length > 0, 'Speech fixture expected words are missing.');
	const recognizedWords = words(result.segments.map(segment => segment.text).join(' '));
	const edits = wordEdits(expectedWords, recognizedWords);
	const wordErrorRate = edits.wordEdits / expectedWords.length;
	const summary = { segments: result.segments.length,
		characters: result.segments.reduce((total, segment) => total + segment.text.length, 0),
		transcript: { expectedWords, recognizedWords, ...edits, wordErrorRate, maximumWordErrorRate: expected.maximumWordErrorRate } };
	if (wordErrorRate > expected.maximumWordErrorRate) throw new ModelFixtureMismatchError(
		`JFK fixture has ${edits.wordEdits} word edits (${wordErrorRate} word error rate).`, summary);
	return summary;
}

export function validateBeatFixtureSemantics(result: AssistanceBeatGridV1, expected: BeatExpectation | undefined) {
	assert.ok(expected && Number.isSafeInteger(expected.count) && expected.count > 0, 'Rhythmic fixture expected beat grid is missing.');
	assert.ok(Number.isFinite(expected.firstBeatSeconds) && expected.firstBeatSeconds >= 0
		&& Number.isFinite(expected.intervalSeconds) && expected.intervalSeconds > 0, 'Invalid expected beat timing.');
	assert.ok(Number.isFinite(expected.maximumTimingErrorSeconds) && expected.maximumTimingErrorSeconds >= 0
		&& expected.maximumTimingErrorSeconds <= 0.05, 'Beat timing tolerance must be at most fifty milliseconds.');
	assert.ok(Number.isFinite(expected.bpm) && expected.bpm > 0 && Number.isFinite(expected.maximumBpmError)
		&& expected.maximumBpmError >= 0 && expected.maximumBpmError <= 1, 'Beat tempo tolerance must be at most one BPM.');
	const timings = result.points.map((point, index) => {
		const expectedSeconds = expected.firstBeatSeconds + index * expected.intervalSeconds;
		const recognizedSeconds = point.sample / result.sampleRate;
		return { expectedSeconds, recognizedSeconds, errorSeconds: Math.abs(recognizedSeconds - expectedSeconds) };
	});
	const maximumObservedTimingErrorSeconds = Math.max(0, ...timings.map(point => point.errorSeconds));
	const recognizedBpm = result.tempoProposal?.kind === 'constant' ? result.tempoProposal.bpm : null;
	const bpmError = recognizedBpm === null ? null : Math.abs(recognizedBpm - expected.bpm);
	const summary = { points: result.points.length, tempoProposal: result.tempoProposal,
		beatGrid: { expectedPointCount: expected.count, observedPointCount: result.points.length, timings,
			maximumObservedTimingErrorSeconds, maximumTimingErrorSeconds: expected.maximumTimingErrorSeconds,
			expectedBpm: expected.bpm, recognizedBpm, bpmError, maximumBpmError: expected.maximumBpmError } };
	if (result.points.length !== expected.count || maximumObservedTimingErrorSeconds > expected.maximumTimingErrorSeconds
		|| bpmError === null || bpmError > expected.maximumBpmError) throw new ModelFixtureMismatchError(
		'The rhythmic fixture does not match its known beat grid or tempo.', summary);
	return summary;
}

export function validateShotFixtureSemantics(result: AssistanceShotBoundariesReviewV1, expected: ShotExpectation | undefined) {
	assert.ok(expected && Number.isSafeInteger(expected.sourceFrame) && expected.sourceFrame > 0,
		'Shot fixture expected boundary is missing.');
	// Models may identify the final old frame or the first new frame at a hard cut.
	const allowedSourceFrames = [expected.sourceFrame - 1, expected.sourceFrame];
	const recognizedFrames = result.boundaries.map(boundary => boundary.sourceFrame);
	const summary = { boundaries: recognizedFrames.length,
		shotBoundaries: { expectedCutFrame: expected.sourceFrame, allowedSourceFrames, recognizedFrames } };
	if (recognizedFrames.length !== 1 || !allowedSourceFrames.includes(recognizedFrames[0]!)) throw new ModelFixtureMismatchError(
		'The shot fixture must have one boundary at the known image switch.', summary);
	return summary;
}
