/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacityEffectOutput } from '../../audacity-effects/pcm-channel-validation.ts';
import { fft, initializePffft } from '../../pffft.js';
import { MATCH_EQ_FREQUENCIES, normalizeMatchEqProfile, type MatchEqProfile } from './definition.ts';
import { matchEqError } from './errors.ts';
import { ownsSelectionWorkerPcm } from '../../selection-effect-pcm-ownership.ts';

export interface MatchEqAnalysisContext {
	readonly isCancelled?: () => boolean;
	readonly onProgress?: (progress: number) => void;
}

export function assertMatchEqCurrent(context: MatchEqAnalysisContext): void {
	if (context.isCancelled?.()) throw new DOMException('Match EQ was cancelled.', 'AbortError');
}

/** Bounded, channel-power analysis; pauses and DC cannot become a tonal target. */
export async function learnMatchEqProfile(channels: unknown, sampleRate: number,
	context: MatchEqAnalysisContext = {}): Promise<MatchEqProfile> {
	assertMatchEqCurrent(context);
	const input = assertAudacityEffectOutput(channels);
	if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Match EQ requires a sample rate from 8000 through 384000 Hz.');
	const frames = input[0]!.length;
	if (frames < sampleRate / 4) throw matchEqError('effectMatchEqTooShort');
	await initializePffft();
	assertMatchEqCurrent(context);
	const size = 2 ** Math.floor(Math.log2(Math.min(frames, sampleRate * .086)));
	const count = Math.min(Math.floor((frames - size) / (size / 2)) + 1, 512, Math.max(1, Math.floor(4194304 / size / input.length)));
	const span = frames - size, denominator = Math.max(1, count - 1);
	const energy = new Float64Array(count);
	// Direct callers can observe progress and still own their PCM. The worker's
	// private inputs and hook-free ordinary buffers admit reuse across passes.
	const reuseMeans = ownsSelectionWorkerPcm(input) || (!context.onProgress && !context.isCancelled
		&& Object.getPrototypeOf(input) === Array.prototype && input[Symbol.iterator] === Array.prototype[Symbol.iterator]
		&& input.every(channel => channel.buffer instanceof ArrayBuffer && Object.getPrototypeOf(channel) === Float32Array.prototype));
	const means = reuseMeans ? new Float64Array(count * input.length) : null;
	let loudest = 0;
	for (let block = 0; block < count; block++) {
		const start = Math.round(span * block / denominator);
		energy[block] = frameEnergy(input, start, size, means, block * input.length);
		loudest = Math.max(loudest, energy[block]!);
	}
	if (!(loudest > 1e-8)) throw matchEqError('effectMatchEqSilent');
	const window = Float64Array.from({ length: size }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (size - 1)));
	const real = new Float64Array(size), imaginary = new Float64Array(size), power = new Float64Array(size / 2 + 1);
	const bandsToMeasure = matchEqBandBins(sampleRate, size);
	const firstBin = bandsToMeasure[0]!.low, lastBin = bandsToMeasure.at(-1)!.high;
	const gate = Math.max(1e-8, loudest * .0001);
	let accepted = 0;
	for (let block = 0; block < count; block++) {
		assertMatchEqCurrent(context);
		const blockEnergy = energy[block]!;
		if (blockEnergy < gate) continue;
		const start = Math.round(span * block / denominator);
		let index = 0;
		for (const channel of input) {
			const mean = means ? means[block * input.length + index]! : channelMean(channel, start, size);
			for (let frame = 0; frame < size; frame++) real[frame] = (channel[start + frame]! - mean) * window[frame]!;
			imaginary.fill(0);
			fft(real, imaginary, false);
			if (index === 0) {
				for (let bin = firstBin; bin <= lastBin; bin++) power[bin] = (real[bin]! ** 2 + imaginary[bin]! ** 2) / blockEnergy;
			} else {
				for (let bin = firstBin; bin <= lastBin; bin++) power[bin] = power[bin]! + (real[bin]! ** 2 + imaginary[bin]! ** 2) / blockEnergy;
			}
			index++;
		}
		accepted++;
		for (const { low, high, values } of bandsToMeasure) {
			let sum = 0;
			for (let bin = low; bin <= high; bin++) sum += power[bin]!;
			values.push(sum / (high - low + 1));
		}
		context.onProgress?.((block + 1) / count);
	}
	const bands = new Array<number>(MATCH_EQ_FREQUENCIES.length).fill(-120);
	let maximum = bandsToMeasure.length < bands.length ? -120 : -Infinity;
	for (const [index, { values }] of bandsToMeasure.entries()) {
		values.sort((left, right) => left - right);
		const trim = Math.floor(values.length * .1);
		const end = values.length - trim;
		let sum = 0;
		for (let offset = trim; offset < end; offset++) sum += values[offset]!;
		const db = 10 * Math.log10(Math.max(1e-30, sum / (end - trim)));
		bands[index] = db;
		maximum = Math.max(maximum, db);
	}
	for (let index = 0; index < bandsToMeasure.length; index++) bands[index] = Math.max(-120, bands[index]! - maximum);
	assertMatchEqCurrent(context);
	return normalizeMatchEqProfile({ version: 1, sampleRate, activeSeconds: frames / sampleRate * accepted / count, bands });
}

function matchEqBandBins(sampleRate: number, size: number) {
	const bands: { low: number; high: number; values: number[] }[] = [];
	const ratio = 2 ** (1 / 12);
	for (const frequency of MATCH_EQ_FREQUENCIES) {
		if (frequency >= sampleRate / 2) break;
		const center = frequency * size / sampleRate;
		const low = Math.max(1, Math.floor(Math.min(center - 1, center / ratio)));
		const high = Math.min(size / 2, Math.ceil(Math.max(center + 1, center * ratio)));
		bands.push({ low, high, values: [] });
	}
	return bands;
}

function channelMean(channel: Float32Array, start: number, size: number): number {
	let mean = 0;
	for (let frame = 0; frame < size; frame++) mean += channel[start + frame]! / size;
	return mean;
}

function frameEnergy(channels: readonly Float32Array[], start: number, size: number, means: Float64Array | null, offset: number): number {
	let energy = 0;
	for (const channel of channels) {
		let sum = 0, squares = 0;
		for (let frame = 0; frame < size; frame++) { const value = channel[start + frame]!; sum += value; squares += value * value; }
		// The power-of-two division preserves the same Float64 rounding as
		// scaling each finite Float32 sample before summation.
		const mean = sum / size;
		if (means) means[offset++] = mean;
		energy += Math.max(0, squares / size - mean ** 2) / channels.length;
	}
	return energy;
}
