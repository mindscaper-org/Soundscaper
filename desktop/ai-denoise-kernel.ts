/* SPDX-License-Identifier: AGPL-3.0-only */

import { AI_DENOISE_HOP, aiDenoiseBlock, aiDenoiseGeometry, type AiDenoiseBlock } from
	'../src/common/editor/first-party-effects/ai-denoise/contract.ts';
import { callSherpaNativeV1, createSherpaNativeExecutorV1, disposeSherpaNativeV1,
	type SherpaAccelerationOptions, type SherpaExecutionProvider } from './assistance-sherpa-acceleration.ts';

interface Denoiser {
	readonly sampleRate: number;
	readonly frameShiftInSamples: number;
	run(request: { samples: Float32Array; sampleRate: number; enableExternalBuffer: false }): { samples: Float32Array; sampleRate: number };
	reset(): void;
	free?(): void;
	dispose?(): void;
}
export interface AiDenoiseNative {
	readonly OnlineSpeechDenoiser: new (config: { model: { provider: string; numThreads: number; debug: number;
		dpdfnet: { model: string } } }) => Denoiser;
}
export interface AiDenoiseMetrics {
	readonly provider: SherpaExecutionProvider;
	readonly meanMs: number;
	readonly p95Ms: number;
	readonly p99Ms: number;
}

/** In-process seam for deterministic tests and CPU baseline measurements. */
export async function createAiDenoiseKernel(runtimeValue: unknown, modelPath: string, channelCount: number,
	options: SherpaAccelerationOptions & { now?: () => number } = {},
) {
	return createSherpaNativeExecutorV1(options).run(undefined, provider =>
		createAiDenoiseKernelForProvider(runtimeValue, modelPath, channelCount, provider, options));
}

/** One native state per channel for the entire playback generation. No WAV staging. */
export function createAiDenoiseKernelForProvider(runtimeValue: unknown, modelPath: string, channelCount: number,
	provider: SherpaExecutionProvider,
	options: SherpaAccelerationOptions & { now?: () => number } = {},
) {
	aiDenoiseGeometry(48000, channelCount);
	const namespace = runtimeValue as Partial<AiDenoiseNative> & { default?: AiDenoiseNative };
	const runtime = (typeof namespace?.OnlineSpeechDenoiser === 'function' ? namespace : namespace?.default) as AiDenoiseNative;
	if (typeof runtime?.OnlineSpeechDenoiser !== 'function') throw new TypeError('The streaming denoiser is unavailable.');
	const now = options.now ?? (() => performance.now());
	const denoisers: Denoiser[] = [];
	let retained = false, closed = false, sequence = 0;
	const dispose = (): void => {
		if (closed) return;
		closed = true;
		for (const denoiser of denoisers) disposeSherpaNativeV1(denoiser);
	};
	try {
		for (let c = 0; c < channelCount; c++) {
			const denoiser = callSherpaNativeV1(() => new runtime.OnlineSpeechDenoiser({ model: {
				numThreads: 1, provider: options.providerForModel?.('dpdfnet2-48khz', provider) ?? provider,
				debug: 0, dpdfnet: { model: modelPath },
			} }));
			denoisers.push(denoiser);
			if (denoiser.sampleRate !== 48000 || denoiser.frameShiftInSamples !== AI_DENOISE_HOP
				|| typeof denoiser.reset !== 'function') throw new TypeError('The denoiser has incompatible streaming geometry.');
		}
		const probe = Float32Array.from({ length: AI_DENOISE_HOP }, (_, i) => .1 * Math.sin(i * .137) + .01 * Math.cos(i * 2.17));
		const timings: number[] = [];
		for (let hop = 0; hop < 80; hop++) {
			const start = now();
			for (const denoiser of denoisers) {
				const audio = callSherpaNativeV1(() => denoiser.run({ samples: probe, sampleRate: 48000, enableExternalBuffer: false }));
				validateAudio(audio, hop === 0 ? 0 : AI_DENOISE_HOP);
			}
			const elapsed = now() - start;
			if (hop >= 16) timings.push(elapsed);
		}
		timings.sort((a, b) => a - b);
		const metrics: AiDenoiseMetrics = { provider, meanMs: timings.reduce((a, b) => a + b, 0) / timings.length,
			p95Ms: timings[Math.ceil(timings.length * .95) - 1]!, p99Ms: timings[Math.ceil(timings.length * .99) - 1]! };
		// Try another authenticated provider if this one cannot sustain 10 ms hops.
		if (metrics.meanMs > 7.5 || metrics.p99Ms >= 10) callSherpaNativeV1(() => {
			throw new Error(`Real-time AI denoising cannot keep up on this device (mean ${metrics.meanMs.toFixed(2)} ms, p99 ${metrics.p99Ms.toFixed(2)} ms). Use Enhance Dialogue instead.`);
		});
		for (const denoiser of denoisers) callSherpaNativeV1(() => denoiser.reset());
		retained = true;
		return Object.freeze({ metrics,
			process(value: unknown): AiDenoiseBlock {
				if (closed) throw new Error('The denoising session is closed.');
				const block = aiDenoiseBlock(value, channelCount, sequence);
				if (block.outputFrames !== 0) throw new TypeError('Invalid AI denoising input block.');
				const frames = sequence === 0 ? 0 : AI_DENOISE_HOP;
				for (let c = 0; c < channelCount; c++) {
					const audio = denoisers[c]!.run({ samples: block.input[c]!, sampleRate: 48000, enableExternalBuffer: false });
					validateAudio(audio, frames);
					block.output[c]!.fill(0);
					block.output[c]!.set(audio.samples);
				}
				sequence++;
				return { ...block, outputFrames: frames };
			}, dispose,
		});
	} finally { if (!retained) dispose(); }
}
function validateAudio(value: { samples: Float32Array; sampleRate: number }, frames: number): void {
	if (value?.sampleRate !== 48000 && !(frames === 0 && value?.sampleRate === 0) || !(value.samples instanceof Float32Array)
		|| value.samples.length !== frames || !value.samples.every(Number.isFinite)) throw new TypeError('The denoiser returned invalid streaming audio.');
}
