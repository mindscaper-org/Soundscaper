/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacityEffectOutput } from '../../audacity-effects/pcm-channel-validation.ts';
import { fft, initializePffft } from '../../pffft.js';
import { MATCH_EQ_FREQUENCIES, normalizeMatchEqProfile, type MatchEqProfile } from './definition.ts';
import { matchEqError } from './errors.ts';

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
	const starts = Array.from({ length: count }, (_, index) => Math.round((frames - size) * index / Math.max(1, count - 1)));
	const energy = starts.map(start => frameEnergy(input, start, size));
	const loudest = Math.max(...energy);
	if (!(loudest > 1e-8)) throw matchEqError('effectMatchEqSilent');
	const window = Float64Array.from({ length: size }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (size - 1)));
	const real = new Float64Array(size), imaginary = new Float64Array(size), power = new Float64Array(size / 2 + 1);
	const observations: number[][] = MATCH_EQ_FREQUENCIES.map(() => []);
	let accepted = 0;
	for (let block = 0; block < count; block++) {
		assertMatchEqCurrent(context);
		if (energy[block]! < Math.max(1e-8, loudest * .0001)) continue;
		const start = starts[block]!;
		power.fill(0);
		for (const channel of input) {
			let mean = 0;
			for (let frame = 0; frame < size; frame++) mean += channel[start + frame]! / size;
			for (let frame = 0; frame < size; frame++) real[frame] = (channel[start + frame]! - mean) * window[frame]!;
			imaginary.fill(0);
			fft(real, imaginary, false);
			for (let bin = 1; bin < power.length; bin++) power[bin] = power[bin]! + (real[bin]! ** 2 + imaginary[bin]! ** 2) / energy[block]!;
		}
		accepted++;
		for (let index = 0; index < MATCH_EQ_FREQUENCIES.length; index++) {
			const frequency = MATCH_EQ_FREQUENCIES[index]!;
			if (frequency >= sampleRate / 2) continue;
			const center = frequency * size / sampleRate;
			const low = Math.max(1, Math.floor(Math.min(center - 1, center / 2 ** (1 / 12))));
			const high = Math.min(power.length - 1, Math.ceil(Math.max(center + 1, center * 2 ** (1 / 12))));
			let sum = 0;
			for (let bin = low; bin <= high; bin++) sum += power[bin]!;
			observations[index]!.push(sum / (high - low + 1));
		}
		context.onProgress?.((block + 1) / count);
	}
	const bands = observations.map(values => {
		if (!values.length) return -120;
		values.sort((left, right) => left - right);
		const trim = Math.floor(values.length * .1);
		const kept = values.slice(trim, values.length - trim);
		return 10 * Math.log10(Math.max(1e-30, kept.reduce((sum, value) => sum + value, 0) / kept.length));
	});
	const maximum = Math.max(...bands);
	assertMatchEqCurrent(context);
	return normalizeMatchEqProfile({ version: 1, sampleRate, activeSeconds: frames / sampleRate * accepted / count,
		bands: bands.map((db, index) => MATCH_EQ_FREQUENCIES[index]! >= sampleRate / 2 ? -120 : Math.max(-120, db - maximum)) });
}

function frameEnergy(channels: readonly Float32Array[], start: number, size: number): number {
	let energy = 0;
	for (const channel of channels) {
		let sum = 0, squares = 0;
		for (let frame = 0; frame < size; frame++) { const value = channel[start + frame]!; sum += value; squares += value * value; }
		energy += Math.max(0, squares / size - (sum / size) ** 2) / channels.length;
	}
	return energy;
}
