/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PhaseCorrectionParams {
	readonly reference: 'left' | 'right';
	readonly maximumShiftMs: number;
	readonly minimumConfidence: number;
}

export const PHASE_CORRECTION_EFFECT_DEFINITION = Object.freeze({
	defaults: Object.freeze({ reference: 'left', maximumShiftMs: 5, minimumConfidence: 85 }),
	ranges: Object.freeze({
		maximumShiftMs: [0, 10, { unit: 'ms', step: .1, taper: 'linear' }],
		minimumConfidence: [50, 100, { unit: '%', step: 1, taper: 'linear' }],
	} satisfies Record<string, [number, number, { unit: string; step: number; taper: string }]>),
	choices: Object.freeze({ reference: Object.freeze({ options: Object.freeze(['left', 'right']) }) }),
	applyToAllAudio: false,
	fullSpectrumOnly: true,
});

export function normalizePhaseCorrectionParams(params: Readonly<Record<string, unknown>> = {}): PhaseCorrectionParams {
	const reference = params.reference ?? 'left';
	if (reference !== 'left' && reference !== 'right') throw new RangeError('Phase correction reference must be left or right.');
	const maximumShiftMs = Number(params.maximumShiftMs ?? 5);
	const minimumConfidence = Number(params.minimumConfidence ?? 85);
	if (!Number.isFinite(maximumShiftMs) || maximumShiftMs < 0 || maximumShiftMs > 10) throw new RangeError('Maximum correction must be between 0 and 10 ms.');
	if (!Number.isFinite(minimumConfidence) || minimumConfidence < 50 || minimumConfidence > 100) throw new RangeError('Minimum confidence must be between 50 and 100 percent.');
	return { reference, maximumShiftMs, minimumConfidence };
}
