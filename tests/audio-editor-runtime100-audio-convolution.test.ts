/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createSameConvolver } from '../src/common/editor/audacity-effects/spectral-convolution.ts';
import { initializePffft } from '../src/common/editor/pffft.js';
await initializePffft();

test('A19 spectral convolution clears only the unfilled FFT suffix', () => {
	const convolve = createSameConvolver(Float64Array.from({ length: 17 }, (_, index) => Math.sin(index * .3) / 17));
	const input = Float32Array.from({ length: 1000 }, (_, index) => Math.sin(index * .13));
	const original = Float64Array.prototype.fill;
	let cleared = 0;
	Float64Array.prototype.fill = function (value, start = 0, end = this.length) { cleared += end - start; return original.call(this, value, start, end); };
	try {
		const output = convolve(input);
		assert.equal(createHash('sha256').update(new Uint8Array(output.buffer)).digest('hex'), 'aa7c18b234939d1383b1e5c6f4d4d963d927d8d3dbd5f8c2232138eb35d8e72d');
		assert.ok(cleared <= 1752, `cleared scratch samples: ${cleared}`);
	} finally { Float64Array.prototype.fill = original; }
	const short = Float32Array.of(-0, .3, -.2, 0);
	assert.deepEqual(convolve(short), createSameConvolver(Float64Array.from({ length: 17 }, (_, index) => Math.sin(index * .3) / 17))(short));
	assert.ok(createSameConvolver(new Float64Array(16))(short).every(Number.isNaN));
});
