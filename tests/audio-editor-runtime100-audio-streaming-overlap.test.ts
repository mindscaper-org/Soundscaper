/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTigerDnrChunkPlanV1, ASSISTANCE_TIGER_DNR_CHUNK_FRAMES } from '../src/common/editor/assistance/tiger-dnr-signal-v1.ts';
import { createTigerDnrStreamingOverlapV1 } from '../src/common/editor/assistance/tiger-dnr-streaming-overlap-v1.ts';

test('A08 streaming TIGER drain resolves private bank headers in one level', () => {
	const plan = createTigerDnrChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 1000 });
	const stems = Array.from({ length: 3 }, (_, stem) => [Float32Array.from({ length: ASSISTANCE_TIGER_DNR_CHUNK_FRAMES }, (_, frame) => Math.sin(frame * .13 + stem) * .3)]);
	const expectedSamples = stems.map(stem => stem[0]!.slice(0, 16));
	const privateBuffers: ArrayBufferLike[] = [];
	const original = Array.from;
	let measuring = false;
	let reads = 0;
	Array.from = new Proxy(original, { apply(target, receiver, args) {
		const array = Reflect.apply(target, receiver, args) as unknown[];
		for (const item of array) if (item instanceof Float32Array && item.length === ASSISTANCE_TIGER_DNR_CHUNK_FRAMES) privateBuffers.push(item.buffer);
		return new Proxy(array, { get(value, key, owner) {
			if (measuring && typeof key === 'string' && /^\d+$/u.test(key)) reads++;
			return Reflect.get(value, key, owner) as unknown;
		} });
	} });
	try {
		const overlap = createTigerDnrStreamingOverlapV1(plan, 1);
		overlap.beginChunk(0);
		overlap.addChannelBatch(0, stems);
		overlap.finishChunk();
		const abort = new AbortController();
		abort.abort();
		assert.throws(() => overlap.drain(16, true, abort.signal), { name: 'AbortError' });
		assert.equal(overlap.paddedPosition, 0);
		measuring = true;
		const result = overlap.drain(16, true);
		measuring = false;
		assert.ok(result);
		for (let stem = 0; stem < 3; stem++) {
			const expected = expectedSamples[stem]!.map(sample => sample / 3);
			assert.deepEqual(result[stem]![0], expected);
			assert.deepEqual(stems[stem]![0]!.subarray(0, 16), expectedSamples[stem]);
			assert.ok(!privateBuffers.includes(result[stem]![0]!.buffer));
			assert.ok(Object.isFrozen(result[stem]));
		}
		assert.ok(Object.isFrozen(result));
		assert.ok(reads <= 60, `private bank header reads: ${reads}`);
		assert.equal(overlap.drain(16, false), null);
		assert.equal(overlap.paddedPosition, 32);
		assert.throws(() => overlap.drain(plan.paddedFrameCount, false), /authority/);
		let checkpoints = 0;
		const signal = new AbortController().signal;
		Object.defineProperty(signal, 'throwIfAborted', { value() { checkpoints++; if (checkpoints === 2) throw new DOMException('stop', 'AbortError'); } });
		assert.throws(() => overlap.drain(20000, true, signal), { name: 'AbortError' });
		assert.equal(checkpoints, 2);
		assert.equal(overlap.paddedPosition, 32);
		assert.ok(overlap.drain(8, true)?.every(stem => stem.every(channel => channel.every(sample => sample === 0))));
	} finally { measuring = false; Array.from = original; }
});
