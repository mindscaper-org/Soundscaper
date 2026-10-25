/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAssistanceBeatThisLogMelV1 } from '../src/common/editor/assistance/beat-this-log-mel-v1.ts';

test('A13-A15 Beat This shares FFT trigonometry, magnitude scale and sparse mel work', async () => {
	const samples = Float32Array.from({ length: 1500 }, (_, frame) => Math.sin(frame * .13) * .3);
	const cosine = Math.cos;
	const sqrt = Math.sqrt;
	const round = Math.fround;
	let cosines = 0;
	let roots = 0;
	let rounds = 0;
	Math.cos = value => { cosines++; return cosine(value); };
	Math.sqrt = value => { roots++; return sqrt(value); };
	Math.fround = value => { rounds++; return round(value); };
	try {
		const result = await createAssistanceBeatThisLogMelV1(samples);
		const hash = createHash('sha256').update(new Uint8Array(result.values.buffer)).digest('hex');
		assert.equal(hash, 'c88724906ed64bd485c76fe5c701f24579257b44c76705112f40d1379a8b24ee');
		assert.ok(cosines <= 4092, `FFT cosines: ${cosines}`);
		assert.ok(roots <= 1, `magnitude square roots: ${roots}`);
		assert.ok(rounds < 160000, `Float32 arithmetic: ${rounds}`);
	} finally { Math.cos = cosine; Math.sqrt = sqrt; Math.fround = round; }
});
