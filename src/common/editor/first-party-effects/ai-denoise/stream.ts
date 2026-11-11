/* SPDX-License-Identifier: AGPL-3.0-only */

import { AI_DENOISE_HOP, AI_DENOISE_LATENCY, AI_DENOISE_POOL, aiDenoiseBlock, aiDenoiseGeometry,
	type AiDenoiseBlock } from './contract.ts';

const RING = 16_384;
/** Fixed timeline: late inference never moves later audio into a missed slot. */
export class AiDenoiseStream {
	private readonly free: AiDenoiseBlock[];
	private readonly pending = new Map<number, AiDenoiseBlock>();
	private readonly ring: Float32Array[];
	private filling: AiDenoiseBlock | undefined;
	private frame = 0;
	private fill = 0;
	private sent = 0;
	private received = 0;
	private written = 0;
	constructor(private readonly channels: number, private readonly send: (block: AiDenoiseBlock) => void) {
		aiDenoiseGeometry(48000, channels);
		this.ring = Array.from({ length: channels }, () => new Float32Array(RING));
		this.free = Array.from({ length: AI_DENOISE_POOL }, (_, slot) => ({ type: 'block', slot, sequence: 0,
			input: Array.from({ length: channels }, () => new Float32Array(AI_DENOISE_HOP)),
			output: Array.from({ length: channels }, () => new Float32Array(AI_DENOISE_HOP)), outputFrames: 0 }));
	}
	receive(value: unknown): void {
		const block = aiDenoiseBlock(value, this.channels, this.received);
		const original = this.pending.get(block.slot);
		if (original?.sequence !== block.sequence
			|| block.outputFrames !== (this.received === 0 ? 0 : AI_DENOISE_HOP)
			|| this.written + block.outputFrames - Math.max(0, this.frame - AI_DENOISE_LATENCY) > RING) {
			throw new Error('Invalid AI denoising block reply ownership.');
		}
		this.pending.delete(block.slot);
		this.received++;
		for (let c = 0; c < this.channels; c++) for (let i = 0; i < block.outputFrames; i++) {
			this.ring[c]![ (this.written + i) % RING ] = block.output[c]![i]!;
		}
		this.written += block.outputFrames;
		this.free.push(original);
	}
	process(input: readonly Float32Array[], output: readonly Float32Array[]): void {
		const frames = output[0]?.length ?? 0;
		if (frames !== 128 || output.length !== this.channels) throw new RangeError('Invalid AI denoising audio quantum.');
		for (let i = 0; i < frames; i++, this.frame++) {
			if (!this.filling) {
				this.filling = this.free.pop();
				if (!this.filling) throw new Error('AI denoising missed its processing deadline.');
			}
			const read = this.frame - AI_DENOISE_LATENCY;
			if (read >= this.written) throw new Error('AI denoising missed its processing deadline.');
			for (let c = 0; c < this.channels; c++) {
				this.filling.input[c]![this.fill] = input[c]?.[i] ?? 0;
				output[c]![i] = read < 0 ? 0 : this.ring[c]![read % RING]!;
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
