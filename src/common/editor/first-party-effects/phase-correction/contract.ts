/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectionEffectSpectralScratchBytes } from '../../selection-effect-spectral-context-contract.ts';

export function phaseCorrectionOutputFrames(frames: number): number {
	if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError('inputFrames must be a positive safe integer.');
	return frames;
}

/** Render/transfer/output/persistence copies plus bounded FFT and sinc scratch. */
export function phaseCorrectionPeakBytes(frames: number, options: {
	readonly sampleRate?: number;
	readonly channelCount?: number;
	readonly spectralWindowSize?: number;
} = {}): number {
	phaseCorrectionOutputFrames(frames);
	const rate = options.sampleRate ?? 48000;
	if (!Number.isInteger(rate) || rate < 8000 || rate > 384000) throw new RangeError('Phase correction sampleRate must be between 8000 and 384000 Hz.');
	if ((options.channelCount ?? 2) !== 2) throw new RangeError('Automatic phase correction requires stereo audio.');
	const bytes = frames * 2 * Float32Array.BYTES_PER_ELEMENT * 4 + 64 * 1024 ** 2
		+ selectionEffectSpectralScratchBytes(frames, 2, options.spectralWindowSize);
	if (!Number.isSafeInteger(bytes)) throw new RangeError('The phase correction memory estimate is too large.');
	return bytes;
}
