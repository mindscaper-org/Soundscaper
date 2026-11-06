/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DynamicsProcessor } from '../src/common/editor/dynamics-worklet.js';

test('an explicitly silent detector cannot fall back to programme audio', () => {
	const runtime = globalThis as typeof globalThis & { sampleRate?: number };
	const previous = runtime.sampleRate;
	runtime.sampleRate = 48_000;
	try {
		const params = { threshold: -20, attack: 0, hold: 0, release: 0, rangeDb: -80 };
		const programme = new Float32Array(128).fill(.5);
		for (const detector of [[], [new Float32Array(128)]]) {
			const gate = new DynamicsProcessor({ processorOptions: { type: 'gate', params } });
			const output = [new Float32Array(128)];
			gate.process([[programme], detector], [output]);
			assert.ok(output[0]!.every(value => Math.abs(value - .00005) < 1e-9));
		}
		const selfDetected = new DynamicsProcessor({ processorOptions: { type: 'gate', params } });
		const output = [new Float32Array(128)];
		selfDetected.process([[programme]], [output]);
		assert.deepEqual(output[0], programme);
	} finally {
		if (previous === undefined) delete runtime.sampleRate;
		else runtime.sampleRate = previous;
	}
});
