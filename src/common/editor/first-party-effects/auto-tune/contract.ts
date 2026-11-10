/* SPDX-License-Identifier: AGPL-3.0-only */

import { STAFFPAD_MAXIMUM_MEMORY_BYTES } from '../../staffpad/parameters.js';
import { selectionEffectSpectralScratchBytes } from '../../selection-effect-spectral-context-contract.ts';

export function autoTuneOutputFrames(frames: number): number {
	if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError('inputFrames must be a positive safe integer.');
	return frames;
}

export function autoTunePeakBytes(frames: number, options: {
	readonly sampleRate?: number;
	readonly channelCount?: number;
	readonly spectralWindowSize?: number;
} = {}): number {
	autoTuneOutputFrames(frames);
	const rate = options.sampleRate ?? 48000, channels = options.channelCount ?? 2;
	if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new RangeError('Auto-Tune sampleRate must be between 8000 and 192000 Hz.');
	if (!Number.isInteger(channels) || channels < 1 || channels > 32) throw new RangeError('Auto-Tune channelCount must be between 1 and 32.');
	// Transferred/rendered input, wet output, persistence, 10 ms pitch contour,
	// the bounded native heap and detector/ABI scratch. Channel pairs render serially.
	const bytes = frames * channels * Float32Array.BYTES_PER_ELEMENT * 4
		+ (Math.ceil(frames / Math.round(rate / 100)) + 1) * Float32Array.BYTES_PER_ELEMENT
		+ STAFFPAD_MAXIMUM_MEMORY_BYTES + 4 * 1024 ** 2
		+ selectionEffectSpectralScratchBytes(frames, channels, options.spectralWindowSize);
	if (!Number.isSafeInteger(bytes)) throw new RangeError('The Auto-Tune selection byte estimate is too large.');
	return bytes;
}
