/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity 3.7.7's spectral noise gate, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/NoiseReductionBase.cpp, by Dominic Mazzoni and
 * Paul Licameli, GPL-2.0-or-later upstream. This modified JavaScript adaptation
 * was created for kw.media in 2026 and selects GPL version 3. Split out of
 * spectral.js; no behaviour changes here.
 */

import { fft } from '../pffft.js';
import { createNoiseReductionGainEnvelope } from './noise-reduction-gain-envelope.ts';

export const NOISE_WINDOW_SIZE = 2_048;
export const NOISE_STEPS_PER_WINDOW = 4;
export const NOISE_HOP_SIZE = NOISE_WINDOW_SIZE / NOISE_STEPS_PER_WINDOW;

export function validateNoiseProfile(profile, sampleRate) {
	if (!profile || profile.type !== 'audacity-noise-profile' || profile.version !== 1) {
		throw new TypeError('A noise profile captured by captureAudacityNoiseProfile is required.');
	}
	if (profile.sampleRate !== sampleRate) {
		throw new RangeError('The noise profile sample rate must match the audio sample rate.');
	}
	if (profile.windowSize !== NOISE_WINDOW_SIZE || profile.stepsPerWindow !== NOISE_STEPS_PER_WINDOW) {
		throw new RangeError('The noise profile uses incompatible analysis settings.');
	}
	if (!(profile.meanPowers instanceof Float32Array) || profile.meanPowers.length !== NOISE_WINDOW_SIZE / 2 + 1) {
		throw new TypeError('The noise profile spectrum is invalid.');
	}
	for (let bin = 0; bin < profile.meanPowers.length; bin += 1) {
		if (!Number.isFinite(profile.meanPowers[bin]) || profile.meanPowers[bin] < 0) {
			throw new RangeError(`The noise profile spectrum is invalid at bin ${bin}.`);
		}
	}
}

export function prepareNoiseReductionGeometry(params, meanPowers) {
	const sensitivity = params.sensitivity * Math.log(10);
	const thresholds = Float64Array.from(meanPowers, power => sensitivity * power);
	const radius = Math.floor(params.frequencySmoothingBands);
	const first = radius > 0 ? new Int32Array(meanPowers.length) : null;
	const end = radius > 0 ? new Int32Array(meanPowers.length) : null;
	if (first) for (let bin = 0; bin < meanPowers.length; bin++) {
		first[bin] = Math.max(0, bin - radius);
		end[bin] = Math.min(meanPowers.length - 1, bin + radius) + 1;
	}
	return { thresholds, first, end };
}

export function reduceNoiseChannel(channel, sampleRate, params, meanPowers, window, attenuation,
	normalization = noiseReductionNormalization(window),
	geometry = prepareNoiseReductionGeometry(params, meanPowers),
	outputRange = { startFrame: 0, endFrame: channel.length }) {
	const padding = NOISE_WINDOW_SIZE - NOISE_HOP_SIZE;
	const windowCount = Math.ceil(channel.length / NOISE_HOP_SIZE) + NOISE_STEPS_PER_WINDOW - 1;
	const binCount = meanPowers.length;
	const workspace = createPowerSpectrumWorkspace(window);
	const powers = Array.from({ length: NOISE_STEPS_PER_WINDOW + 1 }, () => new Float32Array(binCount));
	const neighbors = new Array(powers.length);
	const { startFrame: outputStart, endFrame: outputEnd } = outputRange;
	const firstWindow = Math.floor(outputStart / NOISE_HOP_SIZE);
	const attackBlocks = 1 + Math.floor(0.02 * sampleRate / NOISE_HOP_SIZE);
	const releaseBlocks = 1 + Math.floor(0.1 * sampleRate / NOISE_HOP_SIZE);
	const envelope = createNoiseReductionGainEnvelope(windowCount, binCount, attenuation,
		attenuation ** (1 / releaseBlocks), attenuation ** (1 / attackBlocks), firstWindow);
	let nextPower = 0;

	for (let frame = 0; frame < windowCount; frame += 1) {
		const first = Math.max(0, frame - NOISE_STEPS_PER_WINDOW / 2);
		const last = Math.min(windowCount - 1, frame + NOISE_STEPS_PER_WINDOW / 2);
		while (nextPower <= last) {
			workspace.read(channel, nextPower * NOISE_HOP_SIZE - padding, powers[nextPower % powers.length]);
			nextPower += 1;
		}
		const neighborCount = last - first + 1;
		for (let neighbor = 0; neighbor < neighborCount; neighbor++) neighbors[neighbor] = powers[(first + neighbor) % powers.length];
		for (let bin = 0; bin < binCount; bin += 1) {
			const threshold = geometry.thresholds[bin];
			let above = 0;
			// The gate opens as soon as two neighboring windows exceed the threshold.
			for (let neighbor = 0; neighbor < neighborCount; neighbor += 1) {
				if (neighbors[neighbor][bin] > threshold && ++above === 2) break;
			}
			if (above === 2) envelope.open(frame, bin);
		}
	}

	const reduced = new Float32Array(outputEnd - outputStart);
	const accumulated = new Float64Array(NOISE_WINDOW_SIZE);
	const { real, imaginary } = workspace;
	const prefix = geometry.first ? new Float64Array(binCount + 1) : null;
	const ringMask = NOISE_WINDOW_SIZE - 1;
	const phaseMask = NOISE_HOP_SIZE - 1;
	const lastWindow = Math.ceil(outputEnd / NOISE_HOP_SIZE) + NOISE_STEPS_PER_WINDOW - 1;
	for (let frame = firstWindow; frame < lastWindow; frame += 1) {
		const start = frame * NOISE_HOP_SIZE - padding;
		const gains = envelope.read(frame);
		if (prefix) applyGeometricFrequencySmoothing(gains, binCount, geometry, prefix);
		workspace.load(channel, start);
		fft(real, imaginary, false);
		for (let bin = 0; bin <= NOISE_WINDOW_SIZE / 2; bin += 1) {
			const gain = gains[bin];
			real[bin] *= gain;
			imaginary[bin] *= gain;
			if (bin > 0 && bin < NOISE_WINDOW_SIZE / 2) {
				real[NOISE_WINDOW_SIZE - bin] *= gain;
				imaginary[NOISE_WINDOW_SIZE - bin] *= gain;
			}
		}
		fft(real, imaginary, true);
		const firstOutput = Math.max(0, outputStart - start);
		const endOutput = Math.min(NOISE_WINDOW_SIZE, outputEnd - start);
		for (let index = firstOutput; index < endOutput; index += 1) {
			accumulated[(start + index) & ringMask] += real[index] * window[index];
		}
		for (let index = Math.max(outputStart, start), end = Math.min(outputEnd, start + NOISE_HOP_SIZE); index < end; index += 1) {
			const weight = normalization[index & phaseMask];
			const slot = index & ringMask;
			reduced[index - outputStart] = weight > 1e-12 ? accumulated[slot] / weight : channel[index];
			accumulated[slot] = 0;
		}
	}
	if (params.output === 'reduce') return reduced;
	// Audacity's NRC_LEAVE_RESIDUE multiplies by gain - 1, so its residue
	// has inverted polarity: reduced - original.
	for (let frame = 0; frame < reduced.length; frame += 1) reduced[frame] = reduced[frame] - channel[frame + outputStart];
	return reduced;
}

function applyGeometricFrequencySmoothing(gains, binCount, geometry, prefix) {
	for (let bin = 0; bin < binCount; bin += 1) {
		prefix[bin + 1] = prefix[bin] + Math.log(gains[bin]);
	}
	for (let bin = 0; bin < binCount; bin += 1) {
		const first = geometry.first[bin];
		const end = geometry.end[bin];
		gains[bin] = Math.exp((prefix[end] - prefix[first]) / (end - first));
	}
}

export function powerSpectrum(channel, start, window) {
	return createPowerSpectrumWorkspace(window).read(channel, start);
}

export function createPowerSpectrumWorkspace(window) {
	const size = window.length;
	const real = new Float64Array(size);
	const imaginary = new Float64Array(size);
	const workspace = {
		real, imaginary,
		load(channel, start) {
			const first = Math.min(size, Math.max(0, -start));
			const end = Math.max(first, Math.min(size, channel.length - start));
			real.fill(0, 0, first);
			real.fill(0, end);
			imaginary.fill(0);
			for (let index = first; index < end; index += 1) {
				const sourceIndex = start + index;
				real[index] = channel[sourceIndex] * window[index];
			}
		},
		read(channel, start, powers = new Float32Array(size / 2 + 1)) {
			workspace.load(channel, start);
			fft(real, imaginary, false);
			for (let bin = 0; bin < powers.length; bin += 1) powers[bin] = real[bin] ** 2 + imaginary[bin] ** 2;
			return powers;
		},
	};
	return workspace;
}

export function noiseReductionNormalization(window) {
	const normalization = new Float64Array(NOISE_HOP_SIZE);
	// Padding supplies all overlapping windows at both edges. Add their weights
	// in chronological window order, so each frame keeps its original rounding.
	for (let start = window.length - NOISE_HOP_SIZE; start >= 0; start -= NOISE_HOP_SIZE) {
		for (let phase = 0; phase < NOISE_HOP_SIZE; phase += 1) {
			const value = window[start + phase];
			normalization[phase] += value * value;
		}
	}
	return normalization;
}
