/* SPDX-License-Identifier: AGPL-3.0-only */

import { estimateAudacityEffectPeakBytes } from '../../audacity-effects/contracts.js';

export function matchEqOutputFrames(frames: number): number {
	if (!Number.isSafeInteger(frames) || frames <= 0) throw new RangeError('inputFrames must be a positive safe integer.');
	return frames;
}

/** Existing FIR render/worker/persistence admission plus bounded spectral analysis. */
export function matchEqPeakBytes(frames: number, options: Readonly<{ channelCount?: number; sampleRate?: number }> = {}): number {
	matchEqOutputFrames(frames);
	const sampleRate = options.sampleRate ?? 48000;
	if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Match EQ requires a sample rate from 8000 through 384000 Hz.');
	const bytes = estimateAudacityEffectPeakBytes('audacity-filter-curve-eq', frames, { filterLength: 8191 }, options) + 8 * 1024 ** 2;
	if (!Number.isSafeInteger(bytes)) throw new RangeError('The Match EQ memory estimate is too large.');
	return bytes;
}
