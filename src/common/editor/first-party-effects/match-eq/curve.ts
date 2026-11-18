/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FilterCurvePoint } from '../../audacity-effects/filter-curve.ts';
import { MATCH_EQ_FREQUENCIES, normalizeMatchEqParams, normalizeMatchEqProfile, type MatchEqProfile } from './definition.ts';

/** Compare shapes in dB, discard overall gain, smooth in octaves, and taper unsupported bands. */
export function deriveMatchEqCurve(referenceValue: MatchEqProfile, targetValue: MatchEqProfile,
	options: Readonly<Record<string, unknown>> = {}): readonly FilterCurvePoint[] {
	const reference = normalizeMatchEqProfile(referenceValue), target = normalizeMatchEqProfile(targetValue);
	const params = normalizeMatchEqParams(options);
	const upper = Math.min(params.maximumFrequency, reference.sampleRate / 2, target.sampleRate / 2);
	const supported: { index: number; frequency: number; difference: number }[] = [];
	let total = 0;
	for (const [index, frequency] of MATCH_EQ_FREQUENCIES.entries()) {
		if (frequency >= upper) break;
		if (frequency < params.minimumFrequency || reference.bands[index]! <= -60 || target.bands[index]! <= -60) continue;
		const difference = reference.bands[index]! - target.bands[index]!;
		total += difference;
		supported.push({ index, frequency, difference });
	}
	const offset = total / Math.max(1, supported.length);
	for (const band of supported) band.difference -= offset;
	const sigma = params.smoothing / 2;
	let next = 0, first = 0;
	return MATCH_EQ_FREQUENCIES.map((frequency, index) => {
		if (supported[next]?.index !== index) return Object.freeze({ frequency, gain: 0 });
		next++;
		while (first < supported.length && Math.log2(supported[first]!.frequency / frequency) / sigma < -3) first++;
		let sum = 0, weights = 0;
		for (let neighbor = first; neighbor < supported.length; neighbor++) {
			const band = supported[neighbor]!;
			const distance = Math.log2(band.frequency / frequency) / sigma;
			if (distance > 3) break;
			const weight = Math.exp(-.5 * distance * distance);
			sum += band.difference * weight;
			weights += weight;
		}
		const taper = Math.max(0, Math.min(1, Math.log2(frequency / params.minimumFrequency) * 4, Math.log2(upper / frequency) * 4));
		const gain = weights ? Math.max(-params.maxGainDb, Math.min(params.maxGainDb, sum / weights)) * params.amount / 100 * taper : 0;
		return Object.freeze({ frequency, gain });
	});
}
