/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteSpectralSelection } from '../src/common/editor/spectral-edit.js';
import { initializePffft } from '../src/common/editor/pffft.js';
await initializePffft();

test('full-range full-band spectral Delete emits exact owned silence without constructing FFT buffers', (context) => {
	const original = Float64Array; let spectralArrays = 0;
	globalThis.Float64Array = new Proxy(original, { construct(target, args) {
		if (new Error().stack?.includes('applySpectralGain')) spectralArrays += 1;
		return Reflect.construct(target, args, target) as Float64Array;
	} });
	context.after(() => { globalThis.Float64Array = original; });
	for (const windowSize of [32, 128, 2048, 16384]) {
		for (const frames of [1, 17, windowSize + 1]) {
			const input = Float32Array.from({ length: frames }, (_, frame) => Math.sin(frame / 13));
			const result = deleteSpectralSelection([input, input], { sampleRate: 48000, windowSize });
			for (const channel of result) {
				assert.deepEqual(channel, new Float32Array(frames));
				assert.notEqual(channel, input);
			}
			assert.notEqual(result[0], result[1]);
		}
	}
	assert.equal(spectralArrays, 0);
	assert.throws(() => deleteSpectralSelection([Float32Array.of(0.25)], { sampleRate: 48000, hopSize: 0 }), /hopSize/i);
});
