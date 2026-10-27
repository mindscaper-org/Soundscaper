/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { applyStandardEffect, createStandardEffectProcessor } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();
interface LiveProcessor {
	process(input: readonly Float32Array[], output: readonly Float32Array[]): boolean;
	readAnalysis(): unknown;
	updateParams(params: Readonly<Record<string, unknown>>): void;
	reset(): void;
}
function signal(frames: number, channels: number): Float32Array[] {
	return Array.from({ length: channels }, (_, channel) => Float32Array.from(
		{ length: frames }, (_, frame) => .3 * Math.sin(frame * .037 + channel) + .2 * Math.cos(frame * .113 + channel),
	));
}
// Digests pin every output Float32 word from the production kernels before this
// optimization, including their pending latency, random streams and FIR state.
function digest(channels: readonly Float32Array[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}
function render(processor: LiveProcessor, input: readonly Float32Array[], block: number): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	for (let start = 0; start < input[0].length; start += block) {
		processor.process(input.map(channel => channel.subarray(start, start + block)),
			output.map(channel => channel.subarray(start, start + block)));
	}
	return output;
}

for (const [channelCount, expected] of [
	[1, '0772ae3ed36c8afff5ea548285247f8ede9b8c1703aae13d109769a2ae44f1cc'],
	[2, 'ff7c5830b76da817bb4889e874f08f8de4c70f9db14a8294592ae3eacfc7da27'],
	[4, 'eb1d056d6e151021d350b0e2e33f521dc54d9fe8b4d0b6dd5451ac863218c03f'],
] as const) test(`A03 ordinary ${channelCount}-channel vocoder rotates only audible mono carriers`, () => {
	const original = globalThis.Float64Array;
	let writes = 0;
	let measuring = false;
	globalThis.Float64Array = new Proxy(original, { construct(constructor, args) {
		const value = Reflect.construct(constructor, args) as Float64Array;
		return new Proxy(value, {
			get(target, key) {
				const result: unknown = Reflect.get(target, key, target);
				return typeof result === 'function' ? result.bind(target) as unknown : result;
			},
			set(target, key, sample) {
				if (measuring && typeof key === 'string' && /^\d+$/.test(key)) writes++;
				return Reflect.set(target, key, sample, target);
			},
		});
	} });
	const input = signal(1024, channelCount);
	const output = input.map(() => new Float32Array(1024));
	try {
		const processor = createStandardEffectProcessor({ type: 'vocoder', sampleRate: 48000, channelCount,
			params: { bands: 40, noiseLevel: 13, radarLevel: 7 } });
		measuring = true;
		processor.processBlock(input, output, 1024);
		assert.equal(writes, channelCount === 1 ? 81920 : 0);
		assert.equal(digest(output), expected);
		processor.reset();
		processor.processBlock(input, output, 1024);
		assert.equal(digest(output), expected);
	} finally { globalThis.Float64Array = original; }
});

test('A04 realtime linked surround gate computes one envelope and materializes it before unlinking', (context) => {
	const params = { attack: .1, lookahead: .01, gateFrequency: 500, hold: .05, release: .1, threshold: -40, rangeDb: -24 };
	const linked = createStandardEffectProcessor({ type: 'noise-gate', sampleRate: 8000, channelCount: 8, params });
	const independent = createStandardEffectProcessor({ type: 'noise-gate', sampleRate: 8000, channelCount: 8,
		params: { ...params, stereoLink: 'independent' } });
	const input = Array.from({ length: 8 }, () => new Float32Array(128).fill(.5));
	const actual = input.map(() => new Float32Array(128));
	const expected = input.map(() => new Float32Array(128));
	const original = Math.expm1;
	let attacks = 0;
	const mock = context.mock.method(Math, 'expm1', (value: number) => { attacks++; return original(value); });
	linked.processBlock(input, actual, 128);
	mock.mock.restore();
	assert.equal(attacks, 128);
	independent.processBlock(input, expected, 128);
	assert.deepEqual(actual, expected);
	linked.updateParams({ stereoLink: 'independent' });
	const separate = signal(128, 8);
	linked.processBlock(separate, actual, 128);
	independent.processBlock(separate, expected, 128);
	assert.deepEqual(actual, expected, 'unlink retains attack, hold and audio preview histories on every channel');
	linked.reset(); independent.reset();
	linked.processBlock(separate, actual, 128); independent.processBlock(separate, expected, 128);
	assert.deepEqual(actual, expected);
});

test('A11 fixed selection latency flush clears zero scratch once after the final source samples', (context) => {
	const input = signal(333, 2);
	let clears = 0;
	const original = Float32Array.prototype.fill;
	context.mock.method(Float32Array.prototype, 'fill', function (this: Float32Array, ...args: Parameters<typeof original>) {
		if (this.length === 1024) clears++;
		return original.apply(this, args);
	});
	const actual = applyStandardEffect('noise-gate', input, 8000, { lookahead: 1, threshold: -6, rangeDb: -24 });
	const expected = input.map(channel => Float32Array.from(channel, sample => sample * 10 ** (-24 / 20)));
	assert.deepEqual(actual, expected, 'an active closed gate retains every delayed source sample at its authored floor gain');
	assert.equal(clears, 4, 'two partial input buffers and one silence transition per channel');
});

test('A13 live click removal retains bounded typed input windows with no boxed PCM pushes', () => {
	const input = signal(21000, 2); input[0][5000] = 1; input[1][13000] = -1;
	const processor = createAudacityLiveProcessor('audacity-click-removal', 48000) as LiveProcessor;
	let boxed = 0;
	const original = Array.prototype.push;
	Array.prototype.push = function (this: unknown[], ...values: unknown[]): number {
		if (values.length === 1 && typeof values[0] === 'number') boxed++;
		return original.apply(this, values);
	};
	let output: Float32Array[];
	try { output = render(processor, input, 21000); } finally { Array.prototype.push = original; }
	assert.equal(boxed, 0);
	assert.equal(digest(output), '056c10bde8306895e5152dc3c7a29ee39e1201b1e4d3138d4ad18cc2fef4e3ac');
	processor.reset();
	assert.deepEqual(render(processor, input, 127), output);
});

test('A14 production noise reduction retains a typed input ring and avoids boxed PCM prefix retirement', () => {
	const input = signal(18000, 2);
	const profile = captureAudacityNoiseProfile([input[0].subarray(0, 4096)], 48000);
	const processor = createAudacityLiveProcessor('audacity-noise-reduction', 48000, {}, { noiseProfile: profile }) as LiveProcessor;
	let boxed = 0;
	let retired = 0;
	const original = Array.prototype.push;
	const originalSplice = Array.prototype.splice;
	Array.prototype.push = function (this: unknown[], ...values: unknown[]): number {
		if (values.length === 1 && typeof values[0] === 'number') boxed++;
		return original.apply(this, values);
	};
	Array.prototype.splice = function (this: unknown[], start: number, count: number, ...values: unknown[]): unknown[] {
		if (start === 0 && count > 1024) retired++;
		return originalSplice.call(this, start, count, ...values);
	};
	let output: Float32Array[];
	try { output = render(processor, input, 18000); } finally { Array.prototype.push = original; Array.prototype.splice = originalSplice; }
	assert.ok(boxed <= 315, 'only bounded spectral window scheduling may box numbers; cached preparation may reduce its work');
	assert.equal(retired, 0);
	assert.equal(digest(output), 'a37e7387558b91ee834fb5ac49eee96706d0ef1779302d937d21488f57e581b7');
	processor.reset();
	assert.deepEqual(render(processor, input, 127), output);
});

test('A15 live compressor computes reduction telemetry during the existing output pass', () => {
	const processor = createAudacityLiveProcessor('audacity-compressor', 48000, { lookaheadMs: 0, thresholdDb: -24 }) as LiveProcessor & { transformedEnvelope: Float64Array };
	const input = signal(128, 2);
	const output = input.map(() => new Float32Array(128));
	processor.process(input, output); processor.readAnalysis();
	let reads = 0;
	processor.transformedEnvelope = new Proxy(processor.transformedEnvelope, { get(target, key) {
		if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
		const result: unknown = Reflect.get(target, key, target);
		return typeof result === 'function' ? result.bind(target) as unknown : result;
	} });
	processor.process(input, output);
	assert.equal(reads, 128);
	assert.equal(digest(output), '26c4508e0e6c2a5e928459d22e3ced4311c162f5832593c37270d9a873532fd7');
	assert.deepEqual(processor.readAnalysis(), { frames: 128, inputPeak: .4697645306587219,
		outputPeak: .6336387663492522, reductionDb: -7.693954253825716 });
	assert.equal(processor.readAnalysis(), null);
});
