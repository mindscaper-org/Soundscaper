/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { centeredPeriodicHannStftChannelV1, centeredPeriodicHannIstftChannelsV1 } from '../src/common/editor/assistance/internal/centered-periodic-hann-stft-v1.ts';
import { fftRadixTwoFloat64V1 } from '../src/common/editor/assistance/internal/radix-two-fft-v1.ts';
function digest(planes: readonly (Float32Array | Float64Array)[]): string {
	const hash = createHash('sha256');
	for (const plane of planes) hash.update(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength));
	return hash.digest('hex');
}
function countScratch(operation: () => void): number {
	const original = globalThis.Float64Array;
	let count = 0;
	globalThis.Float64Array = new Proxy(original, { construct(target, args) { count++; return Reflect.construct(target, args) as Float64Array; } });
	try { operation(); } finally { globalThis.Float64Array = original; }
	return count;
}
const samples = Float32Array.from({ length: 4096 }, (_, frame) => .3 * Math.sin(frame * .13));

test('A09 centered Hann STFT reuses two invocation-local FFT planes', () => {
	let hash = '';
	const count = countScratch(() => { const spectrum = centeredPeriodicHannStftChannelV1(samples); hash = digest([spectrum.real, spectrum.imaginary]); });
	assert.equal(hash, '7294abc1717ea4e83a19c730e9911ca00c17e72c3560ce68342cb46883e4b1bf');
	assert.ok(count <= 3, `Float64 scratch allocations: ${count}`);
});
test('A10 centered Hann inverse STFT reuses two invocation-local FFT planes', () => {
	const spectrum = centeredPeriodicHannStftChannelV1(samples);
	let hash = '';
	const count = countScratch(() => { hash = digest(centeredPeriodicHannIstftChannelsV1([spectrum], spectrum.timeFrameCount, samples.length)); });
	assert.equal(hash, '83e8383e16b18d615ed626536a641852cd10a8494384af3e8698d39a230b8395');
	assert.ok(count <= 5, `Float64 scratch allocations: ${count}`);
});
test('A11 FFT shares the twiddle recurrence across butterfly blocks', () => {
	const real = Float64Array.from(samples.subarray(0, 128));
	const imaginary = new Float64Array(128);
	const cosine = Math.cos;
	const sine = Math.sin;
	let multiplies = 0;
	const observed = (value: number): number => ({ valueOf() { multiplies++; return value; } }) as unknown as number;
	Math.cos = value => observed(cosine(value));
	Math.sin = value => observed(sine(value));
	try { fftRadixTwoFloat64V1(real, imaginary, false); } finally { Math.cos = cosine; Math.sin = sine; }
	assert.equal(digest([real, imaginary]), '0b76efdd19f999dddefd744bdb86fa54ca75ec1b5db6d448e93b3ba2f30a82e4');
	assert.ok(multiplies <= 508, `twiddle multiplications: ${multiplies}`);
});

test('FFT keeps historical butterfly order for overlapping and identical views', () => {
	for (const [shift, expected] of [[0, 'e55b35c2597c4da17c261bb42f7c9ee703fa8c18878835db5943bb78ddadbe8e'], [1, 'b32d893ee84f2e351ffd1d372a14ce0a2ce6638f6cf5cf13ce7eb8bd77aa2c71'], [17, '3cdbbd21223bd5363fe3f5e40d63650991ec61456765b32ed3442d2a8e4efc55']] as const) {
		const storage = Float64Array.from({ length: 128 + shift }, (_, frame) => frame % 9 === 0 ? -0 : Math.sin(frame * .3));
		const real = storage.subarray(0, 128);
		const imaginary = storage.subarray(shift, shift + 128);
		fftRadixTwoFloat64V1(real, imaginary, false);
		assert.equal(digest([storage]), expected);
	}
	assert.throws(() => fftRadixTwoFloat64V1(new Float64Array(3), new Float64Array(3), false), RangeError);
});
