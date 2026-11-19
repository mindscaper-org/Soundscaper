/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceFixerSignalV1, parseVoiceFixerMelFiltersV1 } from '../src/common/editor/assistance/voicefixer-signal-v1.ts';
import { voiceFixerMelFilterFixture } from './helpers/voicefixer-mel-filter-fixture.ts';

test('VoiceFixer uses periodic Hann magnitude, linear mel projection and exact 501-frame geometry', () => {
	const signal = createVoiceFixerSignalV1(parseVoiceFixerMelFiltersV1(voiceFixerMelFilterFixture()));
	const mel = signal.analyze(new Float32Array(240_000).fill(0.125));
	assert.equal(mel.length, 501 * 128);
	for (let time = 0; time < 501; time += 1) {
		assert.ok(Math.abs(mel[time * 128]! - 128) < 1e-4);
		assert.equal(mel[time * 128 + 1], 0);
	}
});

test('VoiceFixer center-aligns the vocoder padding, restrains peaks and returns exact 48 kHz frames', () => {
	const signal = createVoiceFixerSignalV1(parseVoiceFixerMelFiltersV1(voiceFixerMelFilterFixture()));
	const input = new Float32Array(223_146).fill(2);
	input.fill(-4, 0, 1_323); input.fill(-4, 221_823);
	const output = signal.synthesize(input);
	assert.equal(output.length, 240_000);
	assert.ok(output.every(value => Math.abs(value - 0.5) < 1e-6));
});

test('VoiceFixer rejects foreign, truncated and nonfinite filterbanks and observes cancellation', () => {
	const bytes = voiceFixerMelFilterFixture();
	assert.throws(() => parseVoiceFixerMelFiltersV1(bytes.subarray(0, bytes.length - 1)));
	const foreign = bytes.slice(); foreign[6] = 2; assert.throws(() => parseVoiceFixerMelFiltersV1(foreign));
	new DataView(bytes.buffer).setFloat32(128, Number.NaN, true); assert.throws(() => parseVoiceFixerMelFiltersV1(bytes));
	const signal = createVoiceFixerSignalV1(parseVoiceFixerMelFiltersV1(voiceFixerMelFilterFixture()));
	const controller = new AbortController(); controller.abort();
	assert.throws(() => signal.analyze(new Float32Array(240_000), controller.signal));
	assert.throws(() => signal.synthesize(new Float32Array(223_146).fill(Infinity)));
});
