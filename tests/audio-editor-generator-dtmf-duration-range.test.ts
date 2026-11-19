/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { generatorDtmfDurations } from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';

/**
 * The DTMF panel of the generator dialog bounds its Duration field at 24 hours
 * (`maximum={86_400}` in src/common/editor/ui/dialogs/GeneratorDialog.jsx) and
 * splits that total into per-symbol tone and silence lengths, so the generator
 * has to accept every length such a total can produce.
 */
const DIALOG_DURATION_MAXIMUM_SECONDS = 24 * 60 * 60;

test('DTMF keeps sample-level timing when the requested tones last one sample each', () => {
	const sampleRate = 96_000;
	const sequence = '1'.repeat(96);
	const timing = generatorDtmfDurations(0.001, 100, sequence.length);
	assert.equal(timing.toneSeconds, 1 / sampleRate);
	const result = generateAudioEditorSignal('dtmf', { sampleRate, sequence, durationSeconds: timing.totalSeconds,
		toneSeconds: timing.toneSeconds, silenceSeconds: timing.silenceSeconds });
	assert.equal(result.frameCount, 96);
});

test('a minimum-length DTMF symbol contains a sample of its two tones', () => {
	const sampleRate = 48_000;
	const sequence = '1234567890ABCD*#'.repeat(3);
	const result = generateAudioEditorSignal('dtmf', {
		sampleRate, sequence, toneSeconds: 1 / sampleRate, silenceSeconds: 0, durationSeconds: 0.001,
	});
	assert.equal(result.frameCount, sequence.length);
	const samples = result.channels[0]!;
	assert.ok(samples.every((sample: number) => Math.abs(sample) > 0.001));
	assert.notEqual(samples[0], samples[1]);
});

test('DTMF generation accepts the per-symbol lengths the generator dialog derives from a long total', () => {
	const sampleRate = 8_000;
	// Generate > DTMF with the shipped defaults (sequence '123', duty 200/3 %)
	// and the Duration field set to five minutes, well inside its own maximum.
	const { toneSeconds, silenceSeconds } = generatorDtmfDurations(300, 2 / 3 * 100, 3);
	assert.ok(toneSeconds > 60, `expected the derived tone length to exceed the old cap, got ${toneSeconds}`);

	const dtmf = generateAudioEditorSignal('dtmf', { sampleRate, sequence: '123', toneSeconds, silenceSeconds });
	assert.equal(
		dtmf.frameCount,
		3 * Math.round(toneSeconds * sampleRate) + 2 * Math.round(silenceSeconds * sampleRate),
	);
	assert.ok(dtmf.channels[0].some((sample) => sample !== 0));
});

test('DTMF tone and silence lengths share the 24-hour ceiling of the other generators', () => {
	// A token sample rate keeps the boundary case small enough to render.
	const sampleRate = 8;
	const full = generateAudioEditorSignal('dtmf', {
		sampleRate,
		sequence: '1',
		toneSeconds: DIALOG_DURATION_MAXIMUM_SECONDS,
		silenceSeconds: 0,
	});
	assert.equal(full.frameCount, DIALOG_DURATION_MAXIMUM_SECONDS * sampleRate);

	assert.throws(() => generateAudioEditorSignal('dtmf', {
		sampleRate,
		sequence: '1',
		toneSeconds: DIALOG_DURATION_MAXIMUM_SECONDS + 1,
		silenceSeconds: 0,
	}), /toneSeconds must be between/);
	assert.throws(() => generateAudioEditorSignal('dtmf', {
		sampleRate,
		sequence: '12',
		toneSeconds: 1,
		silenceSeconds: DIALOG_DURATION_MAXIMUM_SECONDS + 1,
	}), /silenceSeconds must be between/);
});

test('every duty cycle the dialog offers keeps its derived lengths inside the generator range', () => {
	for (let dutyPercent = 1; dutyPercent <= 100; dutyPercent += 1) {
		for (const symbolCount of [1, 3, 16]) {
			const { toneSeconds, silenceSeconds } = generatorDtmfDurations(
				DIALOG_DURATION_MAXIMUM_SECONDS,
				dutyPercent,
				symbolCount,
			);
			assert.ok(
				toneSeconds > 0 && toneSeconds <= DIALOG_DURATION_MAXIMUM_SECONDS,
				`tone ${toneSeconds} out of range at duty ${dutyPercent} % over ${symbolCount} symbols`,
			);
			assert.ok(
				silenceSeconds >= 0 && silenceSeconds <= DIALOG_DURATION_MAXIMUM_SECONDS,
				`silence ${silenceSeconds} out of range at duty ${dutyPercent} % over ${symbolCount} symbols`,
			);
			if (symbolCount === 1) {
				// One symbol leaves no gap to fill, so the total is all tone.
				assert.equal(toneSeconds, DIALOG_DURATION_MAXIMUM_SECONDS);
				assert.equal(silenceSeconds, 0);
			}
		}
	}
});
