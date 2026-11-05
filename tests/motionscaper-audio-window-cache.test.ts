/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionAudioWindowCache } from '../src/common/editor/motion-audio-window-cache.ts';
import type { MotionAudioAsset, MotionAudioFormat, MotionAudioReadRequest, MotionAudioSampleProvider } from '../src/common/editor/motion-audio-contract.ts';

const format: MotionAudioFormat = { sampleRate: 8000, channels: 2, sampleCount: 16384 };
const active = new AbortController().signal;
function asset(id: string): Extract<MotionAudioAsset, { kind: 'audio' }> {
	const sha256 = id.repeat(64);
	return { kind: 'audio', id, name: id, sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1,
		mimeType: 'audio/wav', sampleRate: 8000, channels: 2, duration: { num: 2048, den: 1000 } };
}
function source() {
	const reads: MotionAudioReadRequest[] = [], buffers: Float32Array[] = []; let descriptions = 0;
	const provider: MotionAudioSampleProvider = {
		describe() { descriptions++; return Promise.resolve(format); },
		read(request, signal) {
			signal?.throwIfAborted(); reads.push(request);
			const bytes = Float32Array.from({ length: request.sampleCount * 2 }, (_, index) => (request.startSample + Math.floor(index / 2)) / 16384 * (index % 2 ? -1 : 1));
			buffers.push(bytes); return Promise.resolve(bytes);
		},
	};
	return { provider, reads, buffers, descriptions: () => descriptions };
}

test('repeated and alternating native-window hits preserve exact PCM and MRU eviction', async () => {
	const a = asset('a'), b = asset('b'), c = asset('c'), input = source();
	const cache = createMotionAudioWindowCache(input.provider, 65536);
	const first = await cache.read(a, format, 2048, active);
	for (const position of [2049, 2050.5, 4095]) assert.equal(await cache.read(a, format, position, active), first);
	await cache.read(b, format, 2048, active);
	for (let repeat = 0; repeat < 3; repeat++) {
		assert.equal(await cache.read(a, format, 2050, active), first);
		await cache.read(b, format, 2050, active);
	}
	assert.equal(await cache.read(a, format, 2051, active), first);
	await cache.read(c, format, 2048, active);
	assert.equal(await cache.read(a, format, 2052, active), first, 'The repeated MRU window must survive the next admission.');
	assert.equal(input.reads.length, 3);
	await cache.read(b, format, 2048, active);
	assert.deepEqual(input.reads.map(read => read.asset.id), ['a', 'b', 'c', 'b']);
	assert.ok(input.reads.every(read => read.startSample === 1024 && read.sampleCount === 4096));
	assert.equal(cache.size, 2); assert.equal(cache.byteLength, 65536);
	for (let index = 0; index < first.channels[0]!.length; index++) {
		assert.equal(first.channels[0]![index], (1024 + index) / 16384);
		assert.equal(first.channels[1]![index], -(1024 + index) / 16384);
	}
});

test('last-block retention marks repeated hits and releases silent blocks and explicit clears', async () => {
	const a = asset('a'), input = source(), cache = createMotionAudioWindowCache(input.provider, 32768);
	await cache.describe(a, active); cache.beginBlock();
	const first = await cache.read(a, format, 0, active); cache.endBlock();
	cache.beginBlock(); assert.equal(await cache.read(a, format, 10, active), first); cache.endBlock();
	assert.equal(input.reads.length, 1); assert.equal(cache.size, 1);
	cache.beginBlock(); cache.endBlock(); assert.equal(cache.size, 0); assert.equal(cache.byteLength, 0);
	const second = await cache.read(a, format, 10, active);
	assert.notEqual(second, first); assert.equal(input.reads.length, 2);
	cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.byteLength, 0);
	await cache.describe(a, active); assert.equal(input.descriptions(), 2);
	assert.notEqual(await cache.read(a, format, 10, active), second); assert.equal(input.reads.length, 3);
});

test('an aborted cached hit is not retained by an otherwise empty block', async () => {
	const a = asset('a'), input = source(), cache = createMotionAudioWindowCache(input.provider, 32768);
	cache.beginBlock(); const first = await cache.read(a, format, 0, active); cache.endBlock();
	const cancellation = new AbortController(), reason = new Error('Stopped before a cached sample'); cancellation.abort(reason);
	cache.beginBlock(); await assert.rejects(cache.read(a, format, 1, cancellation.signal), error => error === reason); cache.endBlock();
	assert.equal(cache.size, 0); assert.equal(cache.byteLength, 0); assert.equal(input.reads.length, 1);
	assert.notEqual(await cache.read(a, format, 1, active), first); assert.equal(input.reads.length, 2);
});

test('cancelled and malformed provider reads never leave an admitted or hidden window', async () => {
	const a = asset('a'), input = source(), cancellation = new AbortController(); let mode: 'cancel' | 'malformed' | 'normal' = 'normal';
	const provider: MotionAudioSampleProvider = { ...input.provider, async read(request, signal) {
		const bytes = await input.provider.read(request, signal);
		if (mode === 'cancel') cancellation.abort(new DOMException('Cancelled native read', 'AbortError'));
		return mode === 'malformed' ? bytes.subarray(1) : bytes;
	} };
	const cache = createMotionAudioWindowCache(provider, 32768);
	cache.beginBlock(); await cache.read(a, format, 0, active); cache.endBlock();
	mode = 'cancel'; cache.beginBlock();
	await assert.rejects(cache.read(a, format, 7000, cancellation.signal), { name: 'AbortError' }); cache.endBlock();
	assert.equal(cache.size, 0); assert.equal(cache.byteLength, 0);
	mode = 'malformed'; await assert.rejects(cache.read(a, format, 7000, active), /window length/u);
	assert.equal(cache.size, 0); assert.equal(cache.byteLength, 0);
	mode = 'normal'; const retry = await cache.read(a, format, 7000, active);
	assert.equal(retry.startSample, 5120); assert.equal(retry.endSample, 9216); assert.equal(cache.size, 1);
});

test('cached reads still enforce format metadata, geometry, cancellation and provider-copy ownership', async () => {
	const a = asset('a'), input = source(), cache = createMotionAudioWindowCache(input.provider, 32768);
	assert.throws(() => createMotionAudioWindowCache(input.provider, 32767), /PCM cache/u);
	await cache.describe(a, active);
	await assert.rejects(cache.describe({ ...a, sampleRate: 16000 }, active), /metadata/u);
	await assert.rejects(cache.describe({ ...a, channels: 1 }, active), /metadata/u);
	const first = await cache.read(a, format, 1, active); input.buffers[0]!.fill(Number.NaN);
	assert.equal(await cache.read(a, format, 2, active), first); assert.ok(first.channels.every(channel => channel.every(Number.isFinite)));
	await assert.rejects(cache.read(a, format, Number.NaN, active), /read budget/u);
	await assert.rejects(cache.read(a, { ...format, sampleCount: 0 }, 1, active), /read budget/u);
	const cancellation = new AbortController(); cancellation.abort();
	await assert.rejects(cache.describe(a, cancellation.signal), { name: 'AbortError' });
	assert.equal(input.reads.length, 1); assert.equal(input.descriptions(), 1);
});
