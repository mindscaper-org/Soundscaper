/* SPDX-License-Identifier: AGPL-3.0-only */

import { fft, initializePffft } from './pffft.js';
import { repeatedSoundThreshold, selectRepeatedSoundMatches, type RepeatedSoundMatch } from './repeated-sound.ts';

/** Zero-mean, gain-normalized multichannel correlation, with FFT convolution. */
export async function findRepeatedSoundMatches(
	example: readonly Float32Array[],
	channels: readonly Float32Array[],
	threshold = .9,
): Promise<readonly RepeatedSoundMatch[]> {
	repeatedSoundThreshold(threshold);
	const length = validateChannels(example);
	const frames = validateChannels(channels);
	if (example.length !== channels.length) throw new RangeError('The channel counts must match.');
	if (length > frames) return [];
	const count = frames - length + 1;
	const dots = new Float64Array(count), energies = new Float64Array(count);
	let size = 32;
	while (size < frames + length - 1) size *= 2;
	await initializePffft();
	let exampleEnergy = 0;
	for (let channel = 0; channel < example.length; channel += 1) {
		const template = example[channel]!, samples = channels[channel]!;
		const mean = template.reduce((sum, value) => sum + value, 0) / length;
		const kernel = new Float64Array(size), kernelImaginary = new Float64Array(size);
		for (let frame = 0; frame < length; frame += 1) {
			const value = template[length - 1 - frame]! - mean;
			kernel[frame] = value;
			exampleEnergy += value * value;
		}
		fft(kernel, kernelImaginary);
		const real = new Float64Array(size), imaginary = new Float64Array(size);
		real.set(samples);
		fft(real, imaginary);
		for (let index = 0; index < size; index += 1) {
			const value = real[index]! * kernel[index]! - imaginary[index]! * kernelImaginary[index]!;
			imaginary[index] = real[index]! * kernelImaginary[index]! + imaginary[index]! * kernel[index]!;
			real[index] = value;
		}
		fft(real, imaginary, true);
		let sum = 0, squares = 0;
		for (let frame = 0; frame < length; frame += 1) { sum += samples[frame]!; squares += samples[frame]! ** 2; }
		for (let offset = 0; offset < count; offset += 1) {
			dots[offset] = dots[offset]! + real[offset + length - 1]!;
			energies[offset] = energies[offset]! + Math.max(0, squares - sum * sum / length);
			if (offset + length < frames) {
				const entering = samples[offset + length]!, leaving = samples[offset]!;
				sum += entering - leaving;
				squares += entering * entering - leaving * leaving;
			}
		}
	}
	if (exampleEnergy < length * 1e-12) throw new RangeError('The selected example is silent or constant.');
	const scores = Float64Array.from(dots, (dot, index) => energies[index]! < length * 1e-12 ? 0
		: Math.min(1, Math.abs(dot) / Math.sqrt(exampleEnergy * energies[index]!)));
	const peaks: RepeatedSoundMatch[] = [];
	for (let offset = 0; offset < count; offset += 1) {
		const similarity = scores[offset]!;
		if (similarity + 1e-6 >= threshold && similarity >= (scores[offset - 1] ?? -1)
			&& similarity > (scores[offset + 1] ?? -1)) {
			peaks.push({ startFrame: offset, endFrame: offset + length, similarity });
		}
	}
	return selectRepeatedSoundMatches(peaks);
}


function validateChannels(channels: readonly Float32Array[]): number {
	const length = channels[0]?.length ?? 0;
	if (!length || channels.length > 32 || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== length)) {
		throw new RangeError('Audio channels must have matching, non-empty PCM geometry (at most 32 channels).');
	}
	for (const channel of channels) for (const sample of channel) {
		if (!Number.isFinite(sample)) throw new TypeError('Audio PCM must contain only finite samples.');
	}
	return length;
}
