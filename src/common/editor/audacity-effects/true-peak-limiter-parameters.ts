/* SPDX-License-Identifier: AGPL-3.0-only */

export const TRUE_PEAK_FACTOR = 4;
export const TRUE_PEAK_RADIUS = 16;
export const TRUE_PEAK_FILTER_DELAY = TRUE_PEAK_RADIUS * 2;
export const TRUE_PEAK_FILTER_TAIL = TRUE_PEAK_FILTER_DELAY + 1;
export const TRUE_PEAK_SELECTION_BLOCK = 128;

export function truePeakLimiterLatency(lookaheadMs: number, sampleRate: number): number {
	return TRUE_PEAK_FILTER_DELAY + Math.floor(Math.trunc(lookaheadMs * sampleRate * TRUE_PEAK_FACTOR / 1000) / TRUE_PEAK_FACTOR);
}

/** Conservative peak scratch, including replacement envelope arrays on first use. */
export function truePeakLimiterScratchBytes(lookaheadMs: number, sampleRate: number, channelCount: number): number {
	const lookahead = Math.trunc(lookaheadMs * sampleRate * TRUE_PEAK_FACTOR / 1000);
	return (lookahead + TRUE_PEAK_SELECTION_BLOCK * TRUE_PEAK_FACTOR) * 48
		+ channelCount * Float32Array.BYTES_PER_ELEMENT * (lookahead + 2048);
}
