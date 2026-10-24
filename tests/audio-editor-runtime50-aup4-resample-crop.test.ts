/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resampleChannels } from '../src/common/editor/aup4-export-variants.js';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';

test('Audacity resample crops directly into its owned final buffer', context => {
	const input = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index / 11));
	const natural = resampleChannels([input], 48_000, 44_100)[0] as Float32Array;
	const original = Float32Array.prototype.slice;
	let discardedCopies = 0;
	context.mock.method(Float32Array.prototype, 'slice', function(this: Float32Array, start?: number, end?: number) {
		if (start === 0 && end === 100) discardedCopies++;
		return original.call(this, start, end);
	});
	const cropped = resampleChannels([input], 48_000, 44_100, 100)[0] as Float32Array;
	assert.deepEqual(cropped, natural.subarray(0, 100));
	assert.equal(discardedCopies, 0, 'an oversize joined output must not be allocated and copied just to crop it');
	assert.notStrictEqual(cropped.buffer, input.buffer);
	assert.deepEqual(resampleChannels([new Float32Array([-0, 1])], 48_000, 48_000, 1)[0], new Float32Array([-0]));
});


test('direct crop preserves joined output bytes across rates, padding and legacy frame arguments', () => {
	const input = Float32Array.from({ length: 257 }, (_, index) => index === 0 ? -0 : Math.sin(index / 7));
	for (const rate of [44_100, 48_000, 96_000]) for (const frames of [0, 1, 100, 513, -1, 100.75]) {
		const reference = createStreamingWindowedSincResampler(48_000, rate, 2);
		const head = reference.push([input, input]);
		const tail = (reference.finish as (frames?: number | null) => Float32Array[])(frames);
		const expected = head.map((values: Float32Array, channel: number) => {
			const joined = new Float32Array(values.length + tail[channel].length);
			joined.set(values); joined.set(tail[channel], values.length);
			return joined.length === frames ? joined : joined.slice(0, frames);
		});
		const actual = resampleChannels([input, input], 48_000, rate, frames) as Float32Array[];
		assert.deepEqual(actual, expected);
		assert.notStrictEqual(actual[0]?.buffer, actual[1]?.buffer);
	}
});
