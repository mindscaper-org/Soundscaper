/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FilterCurvePoint } from '../../audacity-effects/filter-curve.ts';
import { MATCH_EQ_FREQUENCIES, normalizeMatchEqParams, normalizeMatchEqProfile, type MatchEqProfile } from './definition.ts';

/** Compare shapes in dB, discard overall gain, smooth in octaves, and taper unsupported bands. */
export function deriveMatchEqCurve(referenceValue: MatchEqProfile, targetValue: MatchEqProfile,
	options: Readonly<Record<string, unknown>> = {}): readonly FilterCurvePoint[] {
	const reference = normalizeMatchEqProfile(referenceValue), target = normalizeMatchEqProfile(targetValue);
	const params = normalizeMatchEqParams(options);
	const upper = Math.min(params.maximumFrequency, reference.sampleRate / 2, target.sampleRate / 2);
	const reliable = MATCH_EQ_FREQUENCIES.map((frequency, index) => frequency >= params.minimumFrequency
		&& frequency < upper && reference.bands[index]! > -60 && target.bands[index]! > -60);
	const differences = reference.bands.map((value, index) => value - target.bands[index]!);
	const supported = differences.filter((_, index) => reliable[index]);
	const offset = supported.reduce((sum, value) => sum + value, 0) / Math.max(1, supported.length);
	return MATCH_EQ_FREQUENCIES.map((frequency, index) => {
		let sum = 0, weights = 0;
		if (reliable[index]) for (let neighbor = 0; neighbor < differences.length; neighbor++) {
			if (!reliable[neighbor]) continue;
			const distance = Math.log2(MATCH_EQ_FREQUENCIES[neighbor]! / frequency) / (params.smoothing / 2);
			if (Math.abs(distance) > 3) continue;
			const weight = Math.exp(-.5 * distance * distance);
			sum += (differences[neighbor]! - offset) * weight;
			weights += weight;
		}
		const taper = Math.max(0, Math.min(1, Math.log2(frequency / params.minimumFrequency) * 4, Math.log2(upper / frequency) * 4));
		const gain = weights ? Math.max(-params.maxGainDb, Math.min(params.maxGainDb, sum / weights)) * params.amount / 100 * taper : 0;
		return Object.freeze({ frequency, gain });
	});
}
