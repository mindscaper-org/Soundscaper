/* SPDX-License-Identifier: GPL-3.0-only */

/** Audacity 4 dial defaults, with Soundscaper's optional true peak limiter. */
const number = (value: number, minimum: number, maximum: number, unit?: string) => ({
	kind: 'number', default: value, minimum, maximum, step: .1, ...(unit ? { unit } : {}),
});

export const audacityCompressorDefinition = {
	category: 'volume', collision: true,
	params: {
		thresholdDb: number(-12, -60, 0, 'dB'),
		makeupGainDb: number(9, -30, 30, 'dB'),
		kneeWidthDb: number(6, 0, 30, 'dB'),
		ratio: number(4, 1, 100),
		lookaheadMs: number(3, 0, 1000, 'ms'),
		attackMs: number(3, 0, 200, 'ms'),
		releaseMs: number(100, 0, 1000, 'ms'),
	},
};

export const audacityLimiterDefinition = {
	category: 'volume', collision: true,
	params: {
		thresholdDb: number(-6, -30, 0, 'dB'),
		makeupTargetDb: number(-1, -30, 0, 'dB'),
		kneeWidthDb: number(2, 0, 10, 'dB'),
		lookaheadMs: number(1, 0, 50, 'ms'),
		releaseMs: number(20, 0, 1000, 'ms'),
		limitTruePeaks: { kind: 'boolean', default: false },
	},
};
