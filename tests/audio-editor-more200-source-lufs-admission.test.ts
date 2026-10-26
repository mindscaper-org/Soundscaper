/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';

const tone = (rate: number) => Float32Array.from({ length: rate * 2 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 500 * frame / rate));
for (const rate of [3000, 3200, 7999]) for (const independent of [false, true]) {
	test(`source LUFS refuses an unsupported ${String(rate)}Hz measurement before altering PCM (independent=${String(independent)})`, () => {
		const channels = [tone(rate)], original = channels[0]!.slice();
		assert.throws(() => applyAudacityEffect('audacity-loudness-normalization', channels, rate,
			{ mode: 'lufs', targetLufs: -23, stereoIndependent: independent, dualMono: false }), /8000.*RMS/u);
		assert.deepEqual(channels[0], original);
	});
}
for (const rate of [3000, 3200]) test(`RMS normalization remains supported for an ordinary ${String(rate)}Hz source`, () => {
	const channels = applyAudacityEffect('audacity-loudness-normalization', [tone(rate)], rate, { mode: 'rms', targetRmsDb: -20 });
	const output = channels[0]!;
	const rms = Math.sqrt(output.reduce((sum: number, sample: number) => sum + sample * sample, 0) / output.length);
	assert.ok(Math.abs(rms - .1) < 1e-6);
});
for (const [rate, peak] of [[8000, .1054951623082161], [48_000, .10788528621196747]] as const) test(`admitted ${String(rate)}Hz LUFS processing retains its existing PCM`, () => {
	const output = applyAudacityEffect('audacity-loudness-normalization', [tone(rate)], rate, { mode: 'lufs', targetLufs: -23, dualMono: false });
	assert.equal(Math.max(...output[0]!), peak); assert.ok(output[0]!.every(Number.isFinite));
});
