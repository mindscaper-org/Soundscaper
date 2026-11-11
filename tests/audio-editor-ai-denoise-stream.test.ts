/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AiDenoiseStream } from '../src/common/editor/first-party-effects/ai-denoise/stream.ts';
import { AI_DENOISE_HOP, AI_DENOISE_LATENCY, type AiDenoiseBlock } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';

test('stream preserves stereo order across quantum/hop boundaries and ring wraps at its declared latency', () => {
	const pending: AiDenoiseBlock[] = [];
	const stream = new AiDenoiseStream(2, block => pending.push(block));
	let previous: Float32Array[] | null = null;
	for (let start = 0; start < 30_720; start += 128) {
		const input = [Float32Array.from({ length: 128 }, (_, i) => (start + i + 1) / 65536),
			Float32Array.from({ length: 128 }, (_, i) => -(start + i + 1) / 65536)];
		const output = [new Float32Array(128), new Float32Array(128)];
		stream.process(input, output);
		for (let i = 0; i < 128; i++) {
			const source = start + i - AI_DENOISE_LATENCY;
			assert.equal(output[0]![i], source < 0 ? 0 : (source + 1) / 65536 * .5);
			assert.equal(output[1]![i], source < 0 ? 0 : -(source + 1) / 65536 * .5);
		}
		for (const block of pending.splice(0)) {
			const next = block.input.map(plane => plane.slice());
			if (previous) for (let c = 0; c < 2; c++) block.output[c]!.set(previous[c]!.map(x => x * .5));
			stream.receive(structuredClone({ ...block, outputFrames: previous ? AI_DENOISE_HOP : 0 }));
			previous = next;
		}
	}
});

test('a missed deadline faults instead of shifting audio or returning dry audio', () => {
	const stream = new AiDenoiseStream(1, () => undefined);
	assert.throws(() => {
		for (let start = 0; start <= AI_DENOISE_LATENCY; start += 128) {
			stream.process([new Float32Array(128).fill(.2)], [new Float32Array(128)]);
		}
	}, /deadline/);
});

test('stream rejects stale, duplicated, nonfinite and wrong-sized replies', () => {
	for (const corrupt of [
		(block: AiDenoiseBlock) => ({ ...block, sequence: 10 }),
		(block: AiDenoiseBlock) => ({ ...block, output: [new Float32Array(1)] }),
		(block: AiDenoiseBlock) => { block.output[0]![0] = NaN; return block; },
	]) {
		const pending: AiDenoiseBlock[] = [];
		const stream = new AiDenoiseStream(1, block => pending.push(block));
		for (let i = 0; i < 4; i++) stream.process([], [new Float32Array(128)]);
		assert.throws(() => stream.receive(corrupt({ ...pending[0]!, outputFrames: 0 })), /reply/);
	}
});
