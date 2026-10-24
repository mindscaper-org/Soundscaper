/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { interpolateAudioLsar } from '../src/common/editor/audacity-effects/spectral-repair-interpolation.js';

function repair(length: number, firstBad: number, badCount: number): Float64Array {
	const samples = Float64Array.from({ length }, (_, frame) => Math.sin(frame * .071) * .3 + Math.cos(frame * .213) * .17);
	let seed = 17;
	interpolateAudioLsar(samples, firstBad, badCount, () => {
		seed = Math.imul(seed, 1_664_525) + 1_013_904_223 | 0;
		return (seed >>> 0) / 0x1_0000_0000;
	});
	return samples;
}

test('Repair owns one reusable normal-equation row instead of allocating each context row', (context) => {
	const Original = Float64Array;
	let damagedSpanArrays = 0;
	const clear = context.mock.method(Original.prototype, 'fill');
	context.mock.property(globalThis, 'Float64Array', new Proxy(Original, {
		construct(target, args: [number]) {
			if (args[0] === 128) damagedSpanArrays++;
			return new target(...args);
		},
	}));
	repair(640, 256, 128);
	assert.equal(damagedSpanArrays, 3, 'right-hand side, reusable row and solved output');
	assert.equal(clear.mock.callCount(), 178, 'only constraints touching the damaged span need a row');
});

test('Repair retains exact autoregression, reversal and fallback bytes', () => {
	for (const [length, firstBad, count, expected] of [
		[640, 256, 128, 'c3195707f47750d3c85a91c15be5dbb0a04a7083a8e6469f159cb96c2c9bb1ec'],
		[97, 31, 17, 'e18b53dfbd767c333bf14a210c55245cc34b73022ce779e7b51819ecfb002fe4'],
		[96, 0, 32, 'cefa96fed1a594eef4d43139f78e3664a89f43f585cc48ffa134e7b863f0c960'],
		[96, 64, 32, '4ecd0e7625465c98a637dc39c5346ec66af0fac9f1e4ed8d00e83a91b3c5a2ac'],
		[5, 2, 1, 'cd88e3941da7c275fc206234accc2ff686294367c4150c3f0ca1f6e8e26297da'],
	] as const) {
		const output = repair(length, firstBad, count);
		const actual = createHash('sha256').update(new Uint8Array(output.buffer)).digest('hex');
		assert.equal(actual, expected, `${String(length)}/${String(firstBad)}/${String(count)}`);
	}
});
