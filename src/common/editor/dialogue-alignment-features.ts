/* SPDX-License-Identifier: AGPL-3.0-only */

import { fftRadixTwoFloat64V1 } from './assistance/internal/radix-two-fft-v1.ts';

const RATE = 8000, HOP = 80, FFT = 256, BANDS = 24, DIMENSIONS = 12;
let featureTables: ReturnType<typeof createFeatureTables> | undefined;
export interface DialogueFeatures {
	readonly count: number;
	readonly vectors: Float32Array;
	readonly active: Uint8Array;
}

/** Gain-independent cepstra; choose a channel so antiphase stereo remains audible. */
export function dialogueFeatures(channels: readonly Float32Array[], sampleRate: number): DialogueFeatures {
	let selected = channels[0]!, greatestEnergy = -1;
	for (const channel of channels) {
		let energy = 0, sum = 0;
		for (const value of channel) {
			if (!Number.isFinite(value)) throw new RangeError('Dialogue PCM must be finite.');
			energy += value * value; sum += value;
		}
		energy -= sum * sum / channel.length;
		if (energy > greatestEnergy) { selected = channel; greatestEnergy = energy; }
	}
	const pcm = dialogueAnalysisPcm(selected, sampleRate);
	const mean = pcm.reduce((sum, value) => sum + value, 0) / pcm.length;
	for (let frame = 0; frame < pcm.length; frame++) pcm[frame] = pcm[frame]! - mean;
	const count = Math.ceil(pcm.length / HOP), vectors = new Float32Array(count * DIMENSIONS), energies = new Float64Array(count);
	const real = new Float64Array(FFT), imaginary = new Float64Array(FFT), logs = new Float64Array(BANDS);
	const { window, cepstrumWeights, melBands, powerBins } = featureTables ??= createFeatureTables();
	const powers = new Float64Array(powerBins);
	for (let frame = 0; frame < count; frame++) {
		imaginary.fill(0);
		for (let index = 0; index < FFT; index++) {
			const source = frame * HOP + index - FFT / 2;
			const value = (pcm[source] ?? 0) - .97 * (pcm[source - 1] ?? 0);
			real[index] = value * window[index]!;
			energies[frame] = energies[frame]! + real[index]! ** 2;
		}
		fftRadixTwoFloat64V1(real, imaginary, false);
		for (let bin = 0; bin < powers.length; bin++) powers[bin] = real[bin]! ** 2 + imaginary[bin]! ** 2;
		for (let band = 0; band < BANDS; band++) {
			const { start, weights } = melBands[band]!;
			let power = 0;
			for (let bin = 0; bin < weights.length; bin++) power += weights[bin]! * powers[start + bin]!;
			logs[band] = Math.log(Math.max(1e-12, power));
		}
		for (let dimension = 0; dimension < DIMENSIONS; dimension++) {
			let cepstrum = 0;
			for (let band = 0; band < BANDS; band++) cepstrum += logs[band]! * cepstrumWeights[dimension * BANDS + band]!;
			vectors[frame * DIMENSIONS + dimension] = cepstrum;
		}
	}
	const peak = energies.reduce((maximum, energy) => Math.max(maximum, energy), 0);
	const active = Uint8Array.from(energies, energy => energy > Math.max(1e-10, peak * .001) ? 1 : 0);
	if (peak < 1e-8 || active.reduce((sum, value) => sum + value, 0) < 10) throw new RangeError('Dialogue is silent or too short.');
	for (let dimension = 0; dimension < DIMENSIONS; dimension++) {
		let sum = 0, weight = 0;
		for (let frame = 0; frame < count; frame++) if (active[frame]) { sum += vectors[frame * DIMENSIONS + dimension]!; weight++; }
		const mean = sum / weight;
		for (let frame = 0; frame < count; frame++) vectors[frame * DIMENSIONS + dimension] = vectors[frame * DIMENSIONS + dimension]! - mean;
	}
	for (let frame = 0; frame < count; frame++) {
		let norm = 0;
		for (let dimension = 0; dimension < DIMENSIONS; dimension++) norm += vectors[frame * DIMENSIONS + dimension]! ** 2;
		norm = Math.sqrt(Math.max(norm, 1e-12));
		for (let dimension = 0; dimension < DIMENSIONS; dimension++) vectors[frame * DIMENSIONS + dimension] = vectors[frame * DIMENSIONS + dimension]! / norm;
	}
	return { count, vectors, active };
}

function createFeatureTables() {
	const window = Float64Array.from({ length: FFT }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (FFT - 1)));
	const cepstrumWeights = Float64Array.from({ length: DIMENSIONS * BANDS }, (_, index) => (
		Math.cos(Math.PI * (Math.floor(index / BANDS) + 1) * (index % BANDS + .5) / BANDS)
	));
	const maxMel = 2595 * Math.log10(1 + 3800 / 700);
	const edges = Array.from({ length: BANDS + 2 }, (_, index) => 700 * (10 ** ((maxMel * index / (BANDS + 1)) / 2595) - 1) * FFT / RATE);
	const melBands = Array.from({ length: BANDS }, (_, band) => {
		const left = edges[band]!, middle = edges[band + 1]!, right = edges[band + 2]!;
		const start = Math.ceil(left);
		const weights = Float64Array.from({ length: Math.ceil(right) - start }, (_, index) => {
			const bin = start + index;
			return bin < middle ? (bin - left) / (middle - left) : (right - bin) / (right - middle);
		});
		return { start, weights };
	});
	return { window, cepstrumWeights, melBands, powerBins: Math.ceil(edges[BANDS + 1]!) };
}

/** Box integration rejects aliases before decimation and retains the partial final box. */
function dialogueAnalysisPcm(input: Float32Array, sampleRate: number): Float32Array {
	const pcm = new Float32Array(Math.round(input.length * RATE / sampleRate));
	const stride = sampleRate / RATE;
	if (Number.isInteger(stride)) {
		for (let frame = 0; frame < pcm.length; frame++) {
			const start = frame * stride, end = Math.min(input.length, start + stride);
			let sum = 0;
			for (let index = start; index < end; index++) sum += input[index]!;
			pcm[frame] = sum / (end - start);
		}
		return pcm;
	}
	for (let frame = 0; frame < pcm.length; frame++) {
		const start = frame * sampleRate / RATE, end = Math.min(input.length, (frame + 1) * sampleRate / RATE);
		let sum = 0;
		for (let index = Math.floor(start); index < Math.ceil(end); index++) {
			sum += input[index]! * Math.max(0, Math.min(end, index + 1) - Math.max(start, index));
		}
		pcm[frame] = sum / (end - start);
	}
	return pcm;
}

export function dialogueFeatureDistance(a: DialogueFeatures, i: number, b: DialogueFeatures, j: number): number {
	if (!a.active[i] || !b.active[j]) return a.active[i] === b.active[j] ? .05 : 1;
	let dot = 0;
	for (let dimension = 0; dimension < DIMENSIONS; dimension++) dot += a.vectors[i * DIMENSIONS + dimension]! * b.vectors[j * DIMENSIONS + dimension]!;
	return Math.max(0, Math.min(1, (1 - dot) / 2));
}
