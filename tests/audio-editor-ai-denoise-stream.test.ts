/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AiDenoiseStream } from '../src/common/editor/first-party-effects/ai-denoise/stream.ts';
import { AI_DENOISE_HOP, AI_DENOISE_LATENCY, aiDenoiseLatencyFrames, type AiDenoiseBlock } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';

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

for (const rate of [8000, 16000, 32000, 44100, 88200, 96000, 192000, 768000]) {
	test(`stream resamples ${rate} Hz stereo around 48 kHz inference without drift or channel mixing`, () => {
		const pending: AiDenoiseBlock[] = [];
		const stream = new AiDenoiseStream(2, block => pending.push(block), rate);
		let previous: Float32Array[] | null = null, error = 0, samples = 0, sent = 0;
		const latency = aiDenoiseLatencyFrames(rate), frames = Math.ceil(rate * .4 / 128) * 128;
		for (let start = 0; start < frames; start += 128) {
			const input = [Float32Array.from({ length: 128 }, (_, i) => .4 * Math.sin(2 * Math.PI * 997 * (start + i) / rate)),
				Float32Array.from({ length: 128 }, (_, i) => .2 * Math.cos(2 * Math.PI * 331 * (start + i) / rate))];
			const output = [new Float32Array(128), new Float32Array(128)];
			stream.process(input, output);
			for (let i = 0; i < 128; i++) {
				const source = start + i - latency;
				if (source < 0) { assert.equal(output[0]![i], 0); assert.equal(output[1]![i], 0); }
				if (source > rate * .02) {
					error += (output[0]![i]! - .2 * Math.sin(2 * Math.PI * 997 * source / rate)) ** 2;
					error += (output[1]![i]! - .1 * Math.cos(2 * Math.PI * 331 * source / rate)) ** 2;
					samples += 2;
				}
			}
			for (const block of pending.splice(0)) {
				assert.equal(block.sequence, sent++);
				assert.equal(block.input[0]!.length, 480);
				const next = block.input.map(plane => plane.slice());
				if (previous) for (let c = 0; c < 2; c++) block.output[c]!.set(previous[c]!.map(x => x * .5));
				stream.receive(structuredClone({ ...block, outputFrames: previous ? 480 : 0 }));
				previous = next;
			}
		}
		assert.ok(Math.sqrt(error / samples) < .001, `RMS error ${Math.sqrt(error / samples)}`);
		assert.ok(Math.abs(sent - frames * 48000 / rate / 480) < 2, `hop count ${sent}`);
	});
}

test('downsampling rejects content above the model Nyquist frequency', () => {
	const stream = new AiDenoiseStream(1, block => {
		assert.ok(block.input[0]!.subarray(64).every(sample => Math.abs(sample) < .005));
		stream.receive({ ...block, outputFrames: block.sequence ? 480 : 0 });
	}, 96000);
	for (let start = 0; start < 96000; start += 128) stream.process([
		Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 33000 * (start + i) / 96000)),
	], [new Float32Array(128)]);
});

test('resampled impulse peaks at the compensated graph frame', () => {
	const pending: AiDenoiseBlock[] = [], rate = 44100, impulse = 1024;
	const stream = new AiDenoiseStream(1, block => pending.push(block), rate);
	let previous: Float32Array | undefined, peak = 0, peakFrame = -1;
	for (let start = 0; start < 20000; start += 128) {
		const input = new Float32Array(128), output = new Float32Array(128);
		if (start <= impulse && impulse < start + 128) input[impulse - start] = 1;
		stream.process([input], [output]);
		for (let i = 0; i < output.length; i++) if (Math.abs(output[i]!) > peak) { peak = Math.abs(output[i]!); peakFrame = start + i; }
		for (const block of pending.splice(0)) {
			const next = block.input[0]!.slice();
			if (previous) block.output[0]!.set(previous);
			stream.receive(structuredClone({ ...block, outputFrames: previous ? 480 : 0 }));
			previous = next;
		}
	}
	assert.equal(peakFrame, impulse + aiDenoiseLatencyFrames(rate));
	assert.ok(peak > .8);
});
