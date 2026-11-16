/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStreamingWindowedSincResampler } from '../../resample.js';
import { AI_DENOISE_HOP, AI_DENOISE_RATE, AI_DENOISE_POOL, aiDenoiseBlock, aiDenoiseRackGeometry, aiDenoiseLatencyFrames,
	type AiDenoiseBlock } from './contract.ts';

const RING = 16_384;
/** Fixed timeline: late inference never moves later audio into a missed slot. */
export class AiDenoiseStream {
	private readonly free: AiDenoiseBlock[];
	private readonly pending = new Map<number, AiDenoiseBlock>();
	private readonly ring: Float32Array[];
	private readonly inputResampler: ReturnType<typeof createStreamingWindowedSincResampler> | null;
	private readonly outputResampler: ReturnType<typeof createStreamingWindowedSincResampler> | null;
	private readonly latency: number;
	private readonly capacity: number;
	private filling: AiDenoiseBlock | undefined;
	private frame = 0;
	private fill = 0;
	private sent = 0;
	private received = 0;
	private written = 0;
	constructor(private readonly channels: number, private readonly send: (block: AiDenoiseBlock) => void, rate = AI_DENOISE_RATE) {
		aiDenoiseRackGeometry(rate, channels);
		this.latency = aiDenoiseLatencyFrames(rate);
		this.capacity = Math.max(RING, Math.ceil(RING * rate / AI_DENOISE_RATE));
		this.inputResampler = rate === AI_DENOISE_RATE ? null : createStreamingWindowedSincResampler(rate, AI_DENOISE_RATE, channels);
		this.outputResampler = rate === AI_DENOISE_RATE ? null : createStreamingWindowedSincResampler(AI_DENOISE_RATE, rate, channels);
		this.ring = Array.from({ length: channels }, () => new Float32Array(this.capacity));
		this.free = Array.from({ length: AI_DENOISE_POOL }, (_, slot) => ({ type: 'block', slot, sequence: 0,
			input: Array.from({ length: channels }, () => new Float32Array(AI_DENOISE_HOP)),
			output: Array.from({ length: channels }, () => new Float32Array(AI_DENOISE_HOP)), outputFrames: 0 }));
	}
	receive(value: unknown): void {
		const block = aiDenoiseBlock(value, this.channels, this.received);
		const original = this.pending.get(block.slot);
		if (original?.sequence !== block.sequence
			|| block.outputFrames !== (this.received === 0 ? 0 : AI_DENOISE_HOP)) {
			throw new Error('Invalid AI denoising block reply ownership.');
		}
		const output = this.outputResampler ? this.outputResampler.push(block.output.map(plane => plane.subarray(0, block.outputFrames))) : block.output;
		const frames = this.outputResampler ? output[0]!.length : block.outputFrames;
		if (this.written + frames - Math.max(0, this.frame - this.latency) > this.capacity) throw new Error('Invalid AI denoising output capacity.');
		this.pending.delete(block.slot);
		this.received++;
		for (let c = 0; c < this.channels; c++) for (let i = 0; i < frames; i++) {
			this.ring[c]![ (this.written + i) % this.capacity ] = output[c]![i]!;
		}
		this.written += frames;
		this.free.push(original);
	}
	process(input: readonly Float32Array[], output: readonly Float32Array[]): void {
		const frames = output[0]?.length ?? 0;
		if (frames !== 128 || output.length !== this.channels) throw new RangeError('Invalid AI denoising audio quantum.');
		const normalized = Array.from({ length: this.channels }, (_, c) => input[c] ?? new Float32Array(frames));
		const modelInput = this.inputResampler ? this.inputResampler.push(normalized) : normalized;
		this.collect(modelInput);
		for (let i = 0; i < frames; i++, this.frame++) {
			const read = this.frame - this.latency;
			if (read >= this.written) throw new Error('AI denoising missed its processing deadline.');
			for (let c = 0; c < this.channels; c++) output[c]![i] = read < 0 ? 0 : this.ring[c]![read % this.capacity]!;
		}
	}
	private collect(input: readonly Float32Array[]): void {
		for (let i = 0; i < input[0]!.length; i++) {
			if (!this.filling) {
				this.filling = this.free.pop();
				if (!this.filling) throw new Error('AI denoising missed its processing deadline.');
			}
			for (let c = 0; c < this.channels; c++) {
				this.filling.input[c]![this.fill] = input[c]![i]!;
			}
			if (++this.fill === AI_DENOISE_HOP) {
				const block = { ...this.filling, sequence: this.sent++, outputFrames: 0 };
				this.pending.set(block.slot, block);
				this.filling = undefined;
				this.fill = 0;
				this.send(block);
			}
		}
	}
}
