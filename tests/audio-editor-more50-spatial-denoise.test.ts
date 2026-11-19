/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { processSpatialDenoiseV1, processSpatialDenoiseCooperativeV1 } from '../src/common/editor/video-motion-denoise-v27.ts';

test('sliding spatial denoise agrees with independent clamped square neighborhoods', async () => {
	for (const [width, height] of [[1, 1], [3, 5], [17, 33], [5, 97]]) {
		const frame = { width: width!, height: height!, samples: Array.from({ length: width! * height! }, (_, index) => (index * 17 % 97) / 97) };
		for (const radius of [1, 4, 16]) for (const strength of [0, 0.3, 1]) {
			const expected = frame.samples.map((original, index) => {
				let sum = 0;
				for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) {
					const sy = Math.max(0, Math.min(frame.height - 1, Math.floor(index / frame.width) + y));
					const sx = Math.max(0, Math.min(frame.width - 1, index % frame.width + x));
					sum += frame.samples[sy * frame.width + sx]!;
				}
				return original + (sum / (radius * 2 + 1) ** 2 - original) * strength;
			});
			for (const result of [processSpatialDenoiseV1(frame, { radius, strength }),
				await processSpatialDenoiseCooperativeV1(frame, { radius, strength })]) {
				for (const [index, sample] of result.samples.entries()) assert.ok(Math.abs(sample - expected[index]!) < 1e-12);
			}
		}
	}
});

test('cooperative spatial denoise yields once per group of output rows and can stop between groups', async (t) => {
	const controller = new AbortController();
	const reason = new DOMException('Denoise cancelled', 'AbortError');
	let yields = 0;
	let cancel = false;
	const enqueue = setImmediate;
	t.mock.method(globalThis, 'setImmediate', (callback: () => void) => enqueue(() => {
		yields += 1;
		if (cancel && yields === 2) controller.abort(reason);
		callback();
	}));
	const frame = { width: 4, height: 97, samples: Array.from({ length: 388 }, (_, index) => index % 3 / 2) };
	const options = { radius: 16, strength: 0.6, signal: controller.signal };
	assert.deepEqual(await processSpatialDenoiseCooperativeV1(frame, options), processSpatialDenoiseV1(frame, options));
	assert.equal(yields, 6);
	yields = 0;
	cancel = true;
	await assert.rejects(processSpatialDenoiseCooperativeV1(frame, options), (error) => error === reason);
	assert.equal(yields, 2);
});
