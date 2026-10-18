/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';
import { FrequencyWaveformAnalyzer } from '../src/common/editor/frequency-waveform-analysis.ts';
import { round4Audio, round4Digest } from './helpers/responsiveness-round4-dsp-fixtures.ts';

test('spectrum failure releases the private lease before another call', () => {
	const input = [round4Audio(211)]; const originalCos = Math.cos;
	Math.cos = (): number => { throw new Error('injected transform preparation failure'); };
	try { assert.throws(() => calculateAudioSpectrum(input, 8000, { size: 512 }), /injected/); } finally { Math.cos = originalCos; }
	const originalArray = globalThis.Float64Array; let allocations = 0;
	globalThis.Float64Array = new Proxy(originalArray, { construct(target, args: unknown[]) { allocations++; return Reflect.construct(target, args) as Float64Array; } });
	try { calculateAudioSpectrum(input, 8000, { size: 512 }); } finally { globalThis.Float64Array = originalArray; }
	assert.equal(allocations, 1, 'only the aborted Hann window is rebuilt; three work buffers are reused');
});

test('rejected loudness chunks retain true-peak drain and reset state exactly', () => {
	const create = () => createEbuR128Meter({ sampleRate: 8000, channelCount: 1, running: true });
	const actual = create(); const expected = create();
	const seed = [Float32Array.of(.7, -0, -.8, .3)];
	actual.push(seed); expected.push(seed);
	assert.throws(() => actual.push([Float32Array.of(0, 0, NaN, 0)]), /finite/);
	assert.deepEqual(actual.snapshot(), expected.snapshot());
	actual.reset(); expected.reset();
	actual.push([new Float32Array(997)]); expected.push([new Float32Array(997)]);
	assert.deepEqual(actual.snapshot(), expected.snapshot());
});

test('frequency waveform retained history is private after each supplied chunk is overwritten', () => {
	const input = [round4Audio(4097), round4Audio(4097, 1)];
	function analyze(overwrite: boolean): string {
		const owner = new FrequencyWaveformAnalyzer({ sampleRate: 8000, channelCount: 2, frameCount: 4097 }, (real, imaginary) => {
			for (let index = 0; index < real.length; index++) { imaginary[index] = real[index]! * .3; real[index] *= .7; }
		});
		for (let start = 0; start < 4097; start += 127) {
			const chunk = input.map(channel => channel.slice(start, start + 127));
			owner.push(chunk);
			if (overwrite) for (const channel of chunk) channel.fill(NaN);
		}
		return round4Digest(owner.finish());
	}
	assert.equal(analyze(true), analyze(false));
});
