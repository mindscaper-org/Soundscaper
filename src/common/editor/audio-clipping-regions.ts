/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAnalysisChannels } from './audio-spectrum.ts';

interface ClippingOptions {
	readonly threshold?: number;
	readonly minimumConsecutiveSamples?: number;
}

export interface AudioClippingRegion {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameCount: number;
	readonly clippedSamples: number;
	readonly peakAmplitude: number;
}

/** Admit consecutive runs per channel, then report their linked time ranges. */
export function findAudioClippingRegions(channels: readonly Float32Array[], options: ClippingOptions = {}): readonly AudioClippingRegion[] {
	validateAnalysisChannels(channels);
	const threshold = Number(options.threshold ?? 1);
	const minimumConsecutiveSamples = Number(options.minimumConsecutiveSamples ?? 3);
	if (!Number.isFinite(threshold) || threshold <= 0) throw new RangeError('Clipping threshold must be positive.');
	if (!Number.isSafeInteger(minimumConsecutiveSamples) || minimumConsecutiveSamples <= 0) {
		throw new RangeError('Minimum consecutive clipping samples must be positive.');
	}
	const frameCount = channels[0]!.length;
	// One byte per rendered frame bounds the union independently of how many
	// overlapping channel runs qualify, without allocating an object per run.
	const covered = new Uint8Array(frameCount);
	for (const channel of channels) {
		let start = -1;
		for (let frame = 0; frame <= frameCount; frame++) {
			if (frame < frameCount && Math.abs(channel[frame]!) >= threshold) {
				if (start < 0) start = frame;
			} else if (start >= 0) {
				if (frame - start >= minimumConsecutiveSamples) covered.fill(1, start, frame);
				start = -1;
			}
		}
	}
	const regions: AudioClippingRegion[] = [];
	let start = -1;
	let peakAmplitude = 0;
	let clippedSamples = 0;
	for (let frame = 0; frame <= frameCount; frame++) {
		if (covered[frame]) {
			if (start < 0) start = frame;
			for (const channel of channels) {
				const amplitude = Math.abs(channel[frame]!);
				peakAmplitude = Math.max(peakAmplitude, amplitude);
				if (amplitude >= threshold) clippedSamples++;
			}
		} else if (start >= 0) {
			regions.push(Object.freeze({ startFrame: start, endFrame: frame,
				frameCount: frame - start, clippedSamples, peakAmplitude }));
			start = -1;
			peakAmplitude = 0;
			clippedSamples = 0;
		}
	}
	return Object.freeze(regions);
}
