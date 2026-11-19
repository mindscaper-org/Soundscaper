/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiDenoiseKernel, type AiDenoiseNative } from '../desktop/ai-denoise-kernel.ts';
import { AI_DENOISE_HOP, type AiDenoiseBlock } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';

function block(sequence: number): AiDenoiseBlock {
	return { type: 'block', sequence, slot: sequence % 16, outputFrames: 0,
		input: [new Float32Array(AI_DENOISE_HOP).fill(.4), new Float32Array(AI_DENOISE_HOP).fill(-.2)],
		output: [new Float32Array(AI_DENOISE_HOP), new Float32Array(AI_DENOISE_HOP)] };
}
function fake() {
	const providers: string[] = [];
	const resets: number[] = [];
	class Denoiser {
		readonly sampleRate = 48000;
		readonly frameShiftInSamples = 480;
		private previous: Float32Array | null = null;
		constructor(config: { model: { provider: string } }) { providers.push(config.model.provider); }
		run({ samples }: { samples: Float32Array }) {
			const output = this.previous?.map(x => x / 2) ?? new Float32Array(0);
			this.previous = samples.slice();
			return { samples: output, sampleRate: output.length ? 48000 : 0 };
		}
		reset() { this.previous = null; resets.push(1); }
	}
	return { runtime: { OnlineSpeechDenoiser: Denoiser } as AiDenoiseNative, providers, resets };
}
test('persistent denoisers preserve channel histories and reset all warmup state before real audio', async () => {
	const f = fake();
	let time = 0;
	const kernel = await createAiDenoiseKernel({ default: f.runtime }, '/reviewed/model', 2, { now: () => time++ });
	assert.equal(f.resets.length, 2);
	assert.equal(kernel.process(block(0)).outputFrames, 0);
	const result = kernel.process(block(1));
	assert.equal(result.outputFrames, 480);
	assert.ok(result.output[0]!.every(x => x === Math.fround(.2)));
	assert.ok(result.output[1]!.every(x => x === Math.fround(-.1)));
	assert.throws(() => kernel.process(block(1)), /reply/);
	kernel.dispose(); kernel.dispose();
	assert.throws(() => kernel.process(block(2)), /closed/);
});
test('native GPU construction failure retries the authenticated CPU provider', async () => {
	const f = fake();
	const Native = f.runtime.OnlineSpeechDenoiser;
	class FailingGpu extends Native {
		constructor(config: ConstructorParameters<typeof Native>[0]) {
			if (config.model.provider === 'webgpu') throw new Error('device lost');
			super(config);
		}
	}
	let time = 0;
	const kernel = await createAiDenoiseKernel({ OnlineSpeechDenoiser: FailingGpu }, '/reviewed/model', 2,
		{ executionProviders: ['webgpu', 'cpu'], now: () => time++ });
	assert.equal(kernel.metrics.provider, 'cpu');
	kernel.dispose();
});
test('a machine that cannot sustain the hop deadline is refused before playback', async () => {
	const f = fake();
	let time = 0;
	await assert.rejects(createAiDenoiseKernel(f.runtime, '/reviewed/model', 2, { now: () => time += 12 }), /keep up/);
});
