/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSISTANCE_TIGER_DNR_CHUNK_FRAMES, createTigerDnrChunkPlanV1, mergeTigerDnrStemV1 } from '../src/common/editor/assistance/tiger-dnr-signal-v1.ts';

test('A08 TIGER merge accumulates only the published source range', () => {
	const frames = 1000;
	const plan = createTigerDnrChunkPlanV1({ schemaVersion: 1, sourceFrameCount: frames });
	const chunks = plan.chunks.map(chunk => ({ chunkIndex: chunk.chunkIndex,
		channels: [Float32Array.from({ length: ASSISTANCE_TIGER_DNR_CHUNK_FRAMES }, (_, frame) => Math.sin(frame * .03 + chunk.chunkIndex) * .4)] }));
	const expected = new Float32Array(frames);
	for (const chunk of plan.chunks) for (let frame = 0; frame < frames; frame++) {
		const local = plan.cropStartFrame + frame - chunk.paddedStartFrame;
		if (local >= 0 && local < chunk.availableFrameCount) expected[frame] = Math.fround(expected[frame]! + chunks[chunk.chunkIndex]!.channels[0]![local]!);
	}
	for (let frame = 0; frame < frames; frame++) expected[frame] = expected[frame]! / 3;
	const original = globalThis.Float32Array;
	let allocated = 0;
	globalThis.Float32Array = new Proxy(original, { construct(target, args) {
		const value = Reflect.construct(target, args) as Float32Array;
		allocated += value.byteLength;
		return value;
	} });
	try {
		const actual = mergeTigerDnrStemV1({ schemaVersion: 1, plan, channelCount: 1, chunks });
		assert.deepEqual(actual[0], expected);
		assert.equal(allocated, frames * 4);
	} finally { globalThis.Float32Array = original; }
	chunks[0]!.channels[0]![0] = NaN;
	assert.throws(() => mergeTigerDnrStemV1({ schemaVersion: 1, plan, channelCount: 1, chunks }), /finite/);
});
