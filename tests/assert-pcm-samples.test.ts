/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual, assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';

test('PCM comparison checks every frame with constant-size diagnostics for large failures', () => {
	const actual = new Float32Array(1_000_000).fill(.25);
	const expected = actual.slice();
	assertPcmSamplesEqual(actual, expected);
	for (const frame of [0, 499_999, 999_999]) {
		actual[frame] = -.25;
		assert.throws(() => { assertPcmSamplesEqual(actual, expected); }, (error: unknown) => {
			assert.ok(error instanceof assert.AssertionError);
			assert.equal(error.actual, -.25);
			assert.equal(error.expected, .25);
			assert.ok(error.message.includes(`sample ${frame}`));
			assert.ok(error.message.length < 512);
			return true;
		});
		actual[frame] = .25;
	}
});

test('PCM failures report channel and frame without retaining or inspecting sample buffers', () => {
	const left = Float32Array.of(.25, -.25);
	const right = Float32Array.of(.5, -.5);
	assertPcmChannelsEqual([left, right], [left.slice(), right.slice()]);
	assert.throws(() => { assertPcmChannelsEqual([left, right], [left, Float32Array.of(.5, 0)]); }, /channel 1 sample 1/u);
	assert.throws(() => { assertPcmSamplesEqual(left, new Float32Array(96_000)); }, /sample count/u);
	assert.throws(() => { assertPcmChannelsEqual([left], [left, right]); }, /channel count/u);
	assert.throws(() => { assertPcmSamplesEqual(undefined, left); }, /is available/u);
	assert.throws(() => { assertPcmSamplesEqual([.25, -.25], left); }, /sample representation/u);
});

test('PCM exactness retains signed zero and NaN equality semantics', () => {
	assertPcmSamplesEqual(Float32Array.of(NaN, -0), Float32Array.of(NaN, -0));
	assert.throws(() => { assertPcmSamplesEqual(Float32Array.of(-0), Float32Array.of(0)); }, /sample 0/u);
});
