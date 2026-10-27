/* SPDX-License-Identifier: GPL-3.0-only */

import { normalizeAudacityEffectParams } from './manifest.js';
import { dbToLinear } from './basic-channel-math.js';
import { validateAudacitySpectralChannels } from './spectral-channel-admission.ts';
import { NOISE_WINDOW_SIZE, noiseReductionNormalization, prepareNoiseReductionGeometry,
	reduceNoiseChannel, validateNoiseProfile } from './spectral-noise-reduction.js';

interface NoiseProfile { readonly meanPowers: Float32Array; }
interface NoiseParameters { readonly sensitivity: number; readonly frequencySmoothingBands: number;
	readonly reductionDb: number; readonly output: 'reduce' | 'residue'; }

/** One processor owns a detached profile and one fixed context geometry. */
export function createPreparedLiveNoiseReduction(profileValue: NoiseProfile, sampleRate: number, frameCount: number) {
	validateNoiseProfile(profileValue, sampleRate);
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new RangeError('Live noise context geometry is invalid.');
	const meanPowers = Float32Array.from(profileValue.meanPowers);
	const window = periodicHann(NOISE_WINDOW_SIZE);
	const normalization = noiseReductionNormalization(frameCount, window);
	let sensitivity: number | undefined, smoothing: number | undefined;
	let geometry: ReturnType<typeof prepareNoiseReductionGeometry> | undefined;
	return Object.freeze({
		process(channels: Float32Array[], params: Readonly<Record<string, unknown>>, startFrame: number, endFrame: number): Float32Array[] {
			if (validateAudacitySpectralChannels(channels, sampleRate).frameCount !== frameCount
				|| !Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
				|| startFrame < 0 || endFrame <= startFrame || endFrame > frameCount) {
				throw new RangeError('Live noise output range disagrees with its owned context.');
			}
			const normalized = normalizeAudacityEffectParams('audacity-noise-reduction', params) as NoiseParameters;
			const attenuation = dbToLinear(-normalized.reductionDb);
			if (attenuation === 1) return channels.map((channel) => normalized.output === 'residue'
				? new Float32Array(endFrame - startFrame) : channel.slice(startFrame, endFrame));
			if (!geometry || sensitivity !== normalized.sensitivity || smoothing !== normalized.frequencySmoothingBands) {
				geometry = prepareNoiseReductionGeometry(normalized, meanPowers);
				sensitivity = normalized.sensitivity; smoothing = normalized.frequencySmoothingBands;
			}
			const preparedGeometry = geometry;
			return channels.map((channel) => reduceNoiseChannel(channel, sampleRate, normalized, meanPowers,
				window, attenuation, normalization, preparedGeometry, { startFrame, endFrame }));
		},
	});
}

function periodicHann(size: number): Float64Array {
	const window = new Float64Array(size);
	for (let index = 0; index < size; index += 1) window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / size);
	return window;
}
