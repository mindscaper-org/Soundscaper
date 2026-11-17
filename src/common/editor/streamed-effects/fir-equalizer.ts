/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Incremental form of audacity-effects/spectral-convolution.ts, retaining its
 * Audacity 3.7.7 attribution, FFT geometry and Float64 accumulation order.
 */
import { fft } from '../pffft.js';
import { buildEqualizationKernel, createGraphicEqCurve, interpolateLinearFrequencyCurve, interpolateLogFrequencyCurve } from '../audacity-effects/spectral-equalization-curves.js';

/** Large offline FFT blocks retain throughput; the realtime partition size is deliberately not inherited. */
export async function* streamFirEqualizer(input: AsyncGenerator<Float32Array[]>, type: string, params: Readonly<Record<string, unknown>>,
	sampleRate: number, frameCount: number): AsyncGenerator<Float32Array[]> {
	const length = Number(params.filterLength);
	const points = params.points as Array<{ frequency: number; gain: number }>;
	const gain = type === 'audacity-graphic-eq' ? createGraphicEqCurve(params.gains, params.interpolation, sampleRate / 2)
		: (frequency: number) => params.linearFrequencyScale ? interpolateLinearFrequencyCurve(points, frequency) : interpolateLogFrequencyCurve(points, frequency);
	const kernel = buildEqualizationKernel(sampleRate, length, gain) as Float64Array;
	const fftSize = 2 ** Math.ceil(Math.log2(length * 2)), blockSize = fftSize - length + 1, mask = fftSize - 1, delay = (length - 1) / 2;
	const kernelReal = new Float64Array(fftSize), kernelImaginary = new Float64Array(fftSize);
	kernelReal.set(kernel); fft(kernelReal, kernelImaginary, false);
	const real = new Float64Array(fftSize), imaginary = new Float64Array(fftSize);
	let incoming: Float32Array[] = [], accumulated: Float64Array[] = [], fill = 0, offset = 0;
	for await (const channels of input) {
		if (!incoming.length) { incoming = channels.map(() => new Float32Array(blockSize)); accumulated = channels.map(() => new Float64Array(fftSize)); }
		for (let from = 0; from < channels[0]!.length;) {
			const count = Math.min(blockSize - fill, channels[0]!.length - from);
			for (let channel = 0; channel < channels.length; channel++) incoming[channel]!.set(channels[channel]!.subarray(from, from + count), fill);
			fill += count; from += count;
			if (fill === blockSize || offset + fill === frameCount) {
				const output = convolve(fill, offset + fill === frameCount); offset += fill; fill = 0;
				if (output[0]!.length) yield output;
			}
		}
	}
	if (offset !== frameCount || fill !== 0) throw new RangeError('Incomplete FIR input.');
	function convolve(count: number, final: boolean): Float32Array[] {
		const convolutionFrames = count + length - 1, end = offset + (final ? convolutionFrames : count);
		const first = Math.max(offset, delay), last = Math.min(end, frameCount + delay);
		return incoming.map((channel, index) => {
			real.fill(0, count); imaginary.fill(0); real.set(channel.subarray(0, count)); fft(real, imaginary, false);
			for (let bin = 0; bin < fftSize; bin++) {
				const re = real[bin]!, im = imaginary[bin]!;
				real[bin] = re * kernelReal[bin]! - im * kernelImaginary[bin]!;
				imaginary[bin] = re * kernelImaginary[bin]! + im * kernelReal[bin]!;
			}
			fft(real, imaginary, true);
			const ring = accumulated[index]!;
			for (let position = 0; position < convolutionFrames; position++) { const slot = (offset + position) & mask; ring[slot] = ring[slot]! + real[position]!; }
			const output = new Float32Array(Math.max(0, last - first));
			for (let frame = offset; frame < end; frame++) {
				const slot = frame & mask; if (frame >= first && frame < last) output[frame - first] = ring[slot]!; ring[slot] = 0;
			}
			return output;
		});
	}
}
