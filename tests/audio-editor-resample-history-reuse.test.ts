/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runGcRegressionInChild } from './helpers/exposed-gc-regression.ts';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';

function source(channels = 8, frames = 4096): Float32Array[] {
	return Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) =>
		frame % 127 === 0 ? -0 : Math.sin(frame * .013 + channel) * .7));
}
function render(input: readonly Float32Array[], rate: number, plan: readonly number[], options = {}): Float32Array[] {
	const sampler = createStreamingWindowedSincResampler(48_000, rate, input.length, options);
	const parts: Float32Array[][] = [];
	for (let offset = 0, chunk = 0; offset < input[0]!.length; chunk++) {
		const count = plan[chunk % plan.length]!;
		parts.push(sampler.push(input.map(channel => channel.subarray(offset, offset + count)))); offset += count;
	}
	parts.push(sampler.finish());
	return input.map((_, channel) => {
		const output = new Float32Array(parts.reduce((total, part) => total + part[channel]!.length, 0));
		let offset = 0;
		for (const part of parts) { output.set(part[channel]!, offset); offset += part[channel]!.length; }
		return output;
	});
}
function digest(channels: readonly Float32Array[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

test('steady surround resampling reuses private PCM concatenation buffers', (context) => {
	const input = source();
	const Original = Float32Array;
	let concatenations = 0;
	context.mock.property(globalThis, 'Float32Array', new Proxy(Original, {
		construct(target, args: [number]) {
			if (typeof args[0] === 'number' && args[0] > 128 && args[0] <= 180) concatenations++;
			return new target(...args);
		},
	}));
	const output = render(input, 96_000, [128]);
	assert.equal(digest(output), '6f4c199d3feb917746246b69931cb0d6b1dc54bbdcad9c7b8cd04df996792a1f');
	assert.ok(concatenations <= input.length * 2, `${concatenations} repeated per-feed PCM concatenations`);
});

for (const [rate, options, expected] of [
	[96_000, {}, '6f4c199d3feb917746246b69931cb0d6b1dc54bbdcad9c7b8cd04df996792a1f'],
	[44_100, {}, '5447dbd22f84b68fd98d6359a5b47bd9e957803bb09107edfdaa5ab1d6bafff0'],
	[16_000, {}, '941858ef491ebe880ddc114b8fb9a1843489a654964f872a651700088b706383'],
	[8_000, { radius: 8 }, 'aefec45bc29c383097e816900642783939c2b07d329e1a506c065c60ff05b84a'],
	[44_100, { initialInputPosition: 3.5 }, 'fe1a0bd76e3e2542d5f2996cea67ba5600e6ff8f79652724406fc97a7157657b'],
] as const) test(`private history preserves exact ${rate}Hz PCM across partitions ${JSON.stringify(options)}`, () => {
	const input = source();
	for (const plan of [[1, 7, 128, 1024], [128], [4096]]) {
		assert.equal(digest(render(input, rate, plan, options)), expected);
	}
});

test('custom typed history retains native copying without invoking an overridden subarray', () => {
	class CustomPcm extends Float32Array {
		override subarray(): never { assert.fail('The retained custom view must not be sliced through its override.'); }
	}
	for (const nextFrames of [128, 65_536]) {
		const ordinary = source(1, nextFrames + 128)[0]!;
		const custom = new CustomPcm(128); custom.set(ordinary.subarray(0, 128));
		const sampler = createStreamingWindowedSincResampler(48_000, 96_000, 1);
		const first = sampler.push([custom]);
		const second = sampler.push([ordinary.subarray(128)]);
		const tail = sampler.finish();
		const output = Float32Array.from([...first[0]!, ...second[0]!, ...tail[0]!]);
		assert.equal(digest([output]), digest(render([ordinary], 96_000, [128, nextFrames])));
	}
});

test('custom channel arrays retain their map and species traversal', () => {
	let maps = 0, species = 0;
	class Channels extends Array<Float32Array> {
		static override get [Symbol.species](): ArrayConstructor { species++; return Channels as unknown as ArrayConstructor; }
		override map<U>(callback: (value: Float32Array, index: number, array: Float32Array[]) => U, thisArg?: unknown): U[] {
			maps++; return super.map(callback, thisArg);
		}
	}
	const input = source(1, 256)[0]!;
	const first = new Channels(); first.push(input.subarray(0, 128));
	const sampler = createStreamingWindowedSincResampler(48_000, 96_000, 1);
	const a = sampler.push(first);
	const b = sampler.push([input.subarray(128)]);
	const c = sampler.finish();
	assert.equal(maps, 4, 'The historical append and three prunes all traverse the custom channel array.');
	assert.equal(species, 4);
	assert.equal(digest([Float32Array.from([...a[0]!, ...b[0]!, ...c[0]!])]), digest(render([input], 96_000, [128])));
});


test('finished and refused samplers release private PCM while their counters remain readable', async (context) => {
	if (runGcRegressionInChild(context, import.meta.url)) return;
	const first = source(1, 128), second = source(1, 32_768);
	const Native = Float32Array;
	const references: WeakRef<ArrayBufferLike>[] = [];
	const track = (channel: Float32Array): Float32Array => {
		if (channel.byteLength) references.push(new WeakRef(channel.buffer));
		return channel;
	};
	context.mock.property(globalThis, 'Float32Array', new Proxy(Native, {
		construct(target, args: ConstructorParameters<Float32ArrayConstructor>) { return track(Reflect.construct(target, args) as Float32Array); },
	}));
	const slice = Native.prototype.slice;
	const sliceDescriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'slice');
	Object.defineProperty(Native.prototype, 'slice', { configurable: true, writable: true, ...sliceDescriptor,
		value(this: Float32Array, start?: number, end?: number) {
			return track(Reflect.apply(slice, this, [start, end]) as Float32Array);
		},
	});
	function completed(refuse: boolean) {
		const sampler = createStreamingWindowedSincResampler(48_000, 96_000, 1);
		sampler.push(first); sampler.push(second);
		if (refuse) assert.throws(() => sampler.finish(NaN), /invalid/u);
		else sampler.finish();
		return sampler;
	}
	try {
		const samplers = [completed(false), completed(true)];
		assert.ok(references.length > 0);
		for (let round = 0; round < 8; round++) { await setImmediate(); globalThis.gc?.(); }
		assert.ok(references.every(reference => reference.deref() === undefined), 'Retaining a closed sampler must not retain its PCM history or reusable capacity.');
		for (const sampler of samplers) {
			assert.equal(sampler.inputFrames, 32_896);
			assert.ok(sampler.outputFrames > 0);
			assert.equal(sampler.finish()[0]!.length, 0);
			assert.throws(() => sampler.push(first), /finished/u);
		}
	} finally {
		if (sliceDescriptor) Object.defineProperty(Native.prototype, 'slice', sliceDescriptor);
		else Reflect.deleteProperty(Native.prototype, 'slice');
	}
});

test('history admission does not invoke unrelated custom channel-array predicates', () => {
	const input = source(1, 256)[0]!;
	const first = [input.subarray(0, 128)], second = [input.subarray(128)];
	for (const packet of [first, second]) Object.defineProperty(packet, 'every', {
		value() { assert.fail('History admission must not invoke the caller\'s every override.'); },
	});
	const sampler = createStreamingWindowedSincResampler(48_000, 96_000, 1);
	const a = sampler.push(first), b = sampler.push(second), c = sampler.finish();
	assert.equal(digest([Float32Array.from([...a[0]!, ...b[0]!, ...c[0]!])]), digest(render([input], 96_000, [128])));
});
