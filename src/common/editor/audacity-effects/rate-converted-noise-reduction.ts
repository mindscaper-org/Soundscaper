/* SPDX-License-Identifier: GPL-3.0-only */

import { createStreamingWindowedSincResampler } from '../resample.js';
import { SampleQueue, channelAt, validateBlock } from './live-processor-base.js';
import { NoiseReductionLiveProcessor } from './live-spectral-processors.js';
import { normalizeAudacityEffectParams } from './manifest.js';
import { NOISE_REDUCTION_RESAMPLE_RADIUS, noiseReductionClockGeometry, noiseReductionClockTailFrames,
	noiseReductionProfileRate } from './noise-reduction-clock.ts';

type Parameters = Readonly<Record<string, unknown>>;
type Resampler = ReturnType<typeof createStreamingWindowedSincResampler>;

/** Keep a captured profile on its original clock when the listening device differs. */
export class RateConvertedNoiseReductionProcessor {
	readonly type = 'audacity-noise-reduction';
	private inner: NoiseReductionLiveProcessor;
	private profileRate: number;
	private inputResampler: Resampler | null = null;
	private outputResampler: Resampler | null = null;
	private queues: SampleQueue[] = [];
	private dry: Float32Array[] = [];
	private cursor = 0;
	private requestedOutput: unknown;
	constructor(readonly sampleRate: number, params: Parameters, profile: unknown) {
		this.profileRate = noiseReductionProfileRate(profile, sampleRate);
		this.requestedOutput = params.output;
		this.inner = new NoiseReductionLiveProcessor(this.profileRate,
			this.profileRate === sampleRate ? params : { ...params, output: 'residue' }, profile);
	}
	get latencyFrames(): number {
		return noiseReductionClockGeometry(this.sampleRate, this.profileRate, this.inner.latencyFrames).latencyFrames;
	}
	get tailFrames(): number {
		return noiseReductionClockTailFrames(this.sampleRate, this.profileRate, this.inner.tailFrames);
	}
	get params(): Parameters { return { ...this.inner.params, output: this.requestedOutput }; }
	updateParams(params: Parameters): void {
		const normalized: Parameters = normalizeAudacityEffectParams(this.type, { ...this.params, ...params });
		this.inner.updateParams(this.profileRate === this.sampleRate ? normalized : { ...normalized, output: 'residue' });
		this.requestedOutput = normalized.output;
	}
	setNoiseProfile(profile: unknown): void {
		const rate = noiseReductionProfileRate(profile, this.sampleRate);
		const replacement = new NoiseReductionLiveProcessor(rate,
			rate === this.sampleRate ? this.params : { ...this.params, output: 'residue' }, profile);
		this.profileRate = rate; this.inner = replacement; this.reset();
	}
	reset(): void {
		this.inner.reset(); this.inputResampler = null; this.outputResampler = null; this.queues = []; this.dry = []; this.cursor = 0;
	}
	readAnalysis(): null { return null; }
	process(input: readonly Float32Array[], output: readonly Float32Array[]): boolean {
		const frames: number = validateBlock(input, output);
		if (this.profileRate === this.sampleRate) return this.inner.process(input, output);
		if (output.length !== this.queues.length) this.prepare(output.length);
		const incoming = this.inputResampler!.push(output.map((_, channel) => channelAt(input, channel) ?? new Float32Array(frames)));
		const processed = incoming.map(channel => new Float32Array(channel.length));
		this.inner.process(incoming, processed);
		const converted = this.outputResampler!.push(processed);
		for (let channel = 0; channel < output.length; channel++) {
			this.queues[channel]!.push(converted[channel]!);
			if (this.queues[channel]!.length < frames) throw new Error('Noise Reduction clock conversion exhausted its bounded reserve.');
		}
		// Convert the removed noise, not the complete recording. Device samples
		// outside a lower-rate profile's bandwidth must retain their dry signal.
		for (let frame = 0; frame < frames; frame++) {
			for (let channel = 0; channel < output.length; channel++) {
				const ring = this.dry[channel]!;
				const dry = ring[this.cursor]!; ring[this.cursor] = channelAt(input, channel)?.[frame] ?? 0;
				const removed: number = this.queues[channel]!.shift();
				output[channel]![frame] = this.requestedOutput === 'residue' ? removed : dry - removed;
			}
			this.cursor = (this.cursor + 1) % this.dry[0]!.length;
		}
		return true;
	}
	private prepare(channelCount: number): void {
		this.inner.reset();
		const geometry = noiseReductionClockGeometry(this.sampleRate, this.profileRate, this.inner.latencyFrames);
		const options = { radius: NOISE_REDUCTION_RESAMPLE_RADIUS };
		this.inputResampler = createStreamingWindowedSincResampler(this.sampleRate, this.profileRate, channelCount, options);
		this.outputResampler = createStreamingWindowedSincResampler(this.profileRate, this.sampleRate, channelCount,
			{ ...options, initialInputPosition: geometry.outputPhase });
		this.queues = Array.from({ length: channelCount }, () => {
			const queue = new SampleQueue(); queue.push(new Float32Array(geometry.reserveFrames)); return queue;
		});
		this.dry = Array.from({ length: channelCount }, () => new Float32Array(geometry.latencyFrames)); this.cursor = 0;
	}
}
