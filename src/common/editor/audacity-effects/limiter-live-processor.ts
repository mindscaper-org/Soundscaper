/* SPDX-License-Identifier: GPL-3.0-only */

import { DynamicsLiveProcessor } from './live-dynamics-processors.js';
import { normalizeAudacityEffectParams } from './manifest.js';
import { validateBlock } from './live-processor-base.js';
import { TruePeakOversampler } from './true-peak-oversampler.ts';
import { TRUE_PEAK_FACTOR, TRUE_PEAK_FILTER_TAIL, TRUE_PEAK_SELECTION_BLOCK, truePeakLimiterLatency } from './true-peak-limiter-parameters.ts';

type Parameters = Readonly<Record<string, unknown>>;

/** Run the existing linked limiter on reconstructed samples when opted in. */
export class LimiterLiveProcessor {
	readonly type = 'audacity-limiter';
	params: Parameters;
	private inner: DynamicsLiveProcessor;
	private converter: TruePeakOversampler | null = null;
	private incoming: Float32Array[] = [];
	private limited: Float32Array[] = [];
	private capacity = 0;
	private channelCount = 0;
	private analysisFrames = 0;
	constructor(readonly sampleRate: number, params: Parameters) {
		this.params = normalizeAudacityEffectParams(this.type, params) as Parameters;
		this.inner = this.createInner();
	}
	get latencyFrames(): number {
		return this.params.limitTruePeaks ? truePeakLimiterLatency(Number(this.params.lookaheadMs), this.sampleRate) : this.inner.latencyFrames;
	}
	get tailFrames(): number { return this.params.limitTruePeaks ? TRUE_PEAK_FILTER_TAIL : 0; }
	updateParams(params: Parameters = {}): void {
		const previous = this.params;
		this.params = normalizeAudacityEffectParams(this.type, { ...previous, ...params }) as Parameters;
		if (previous.limitTruePeaks !== this.params.limitTruePeaks || previous.lookaheadMs !== this.params.lookaheadMs) {
			this.inner = this.createInner(); this.reset();
		} else this.inner.updateParams({ ...this.params, limitTruePeaks: false });
	}
	reset(): void {
		this.inner.reset(); this.converter = null; this.channelCount = 0; this.analysisFrames = 0;
	}
	readAnalysis(): { frames: number; inputPeak: number; outputPeak: number; reductionDb: number } | null {
		const analysis = this.inner.readAnalysis();
		if (!analysis) return null;
		const frames = this.analysisFrames; this.analysisFrames = 0;
		return { frames, inputPeak: analysis.inputPeak ?? 0, outputPeak: analysis.outputPeak ?? 0, reductionDb: analysis.reductionDb ?? 0 };
	}
	process(input: readonly Float32Array[], output: readonly Float32Array[]): boolean {
		const frames: number = validateBlock(input, output);
		this.analysisFrames += frames;
		if (!this.params.limitTruePeaks) return this.inner.process(input, output);
		if (!frames || !output.length) return true;
		if (this.channelCount !== output.length) {
			this.channelCount = output.length; this.converter = new TruePeakOversampler(output.length);
			this.inner.reset(); this.capacity = 0;
		}
		const extent = frames * TRUE_PEAK_FACTOR;
		if (extent > this.capacity) {
			this.incoming = output.map(() => new Float32Array(extent));
			this.limited = output.map(() => new Float32Array(extent)); this.capacity = extent;
		}
		const incoming = this.incoming.map(channel => channel.subarray(0, extent));
		const limited = this.limited.map(channel => channel.subarray(0, extent));
		this.converter!.upsample(input, incoming, frames);
		this.inner.process(incoming, limited);
		this.converter!.downsample(limited, output, (this.inner.lookaheadFrames ?? 0) % TRUE_PEAK_FACTOR);
		return true;
	}
	private createInner(): DynamicsLiveProcessor {
		return new DynamicsLiveProcessor(this.type, this.sampleRate * (this.params.limitTruePeaks ? TRUE_PEAK_FACTOR : 1),
			{ ...this.params, limitTruePeaks: false });
	}
}

/** Bounded scratch and a latency flush preserve the selection's exact extent. */
export function applyTruePeakLimiter(channels: readonly Float32Array[], sampleRate: number, params: Parameters): Float32Array[] {
	const processor = new LimiterLiveProcessor(sampleRate, params);
	const length = channels[0]!.length;
	const result = channels.map(() => new Float32Array(length));
	const blockSize = TRUE_PEAK_SELECTION_BLOCK;
	const input = channels.map(() => new Float32Array(blockSize));
	const output = channels.map(() => new Float32Array(blockSize));
	for (let offset = 0; offset < length + processor.latencyFrames; offset += blockSize) {
		for (let channel = 0; channel < channels.length; channel++) {
			input[channel]!.fill(0);
			if (offset < length) input[channel]!.set(channels[channel]!.subarray(offset, offset + blockSize));
		}
		processor.process(input, output);
		const start = Math.max(0, processor.latencyFrames - offset);
		const end = Math.min(blockSize, length + processor.latencyFrames - offset);
		if (end <= start) continue;
		for (let channel = 0; channel < channels.length; channel++) {
			result[channel]!.set(output[channel]!.subarray(start, end), Math.max(0, offset - processor.latencyFrames));
		}
	}
	return result;
}
