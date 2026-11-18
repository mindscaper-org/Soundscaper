/* SPDX-License-Identifier: AGPL-3.0-only */

export const MATCH_EQ_FREQUENCIES: readonly number[] = Object.freeze(
	Array.from({ length: 128 }, (_, index) => 20 * 1000 ** (index / 127)),
);

/** A portable tonal target, independent of any particular recording's correction. */
export interface MatchEqProfile {
	readonly version: 1;
	readonly sampleRate: number;
	readonly activeSeconds: number;
	readonly bands: readonly number[];
}

const ownedProfiles = new WeakSet<MatchEqProfile>();

export interface MatchEqParams extends Readonly<Record<string, unknown>> {
	readonly reference: MatchEqProfile | null;
	readonly amount: number;
	readonly smoothing: number;
	readonly maxGainDb: number;
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
}

export const MATCH_EQ_EFFECT_DEFINITION = Object.freeze({
	defaults: Object.freeze({ reference: null, amount: 100, smoothing: .5, maxGainDb: 6,
		minimumFrequency: 80, maximumFrequency: 16000 }),
	ranges: Object.freeze({
		amount: [0, 100, { unit: '%', step: 1, taper: 'linear' }],
		smoothing: [.25, 2, { unit: 'oct', step: .05, taper: 'linear' }],
		maxGainDb: [0, 18, { unit: 'dB', step: .5, taper: 'linear' }],
		minimumFrequency: [20, 2000, { unit: 'Hz', step: 1, taper: 'logarithmic' }],
		maximumFrequency: [1000, 20000, { unit: 'Hz', step: 1, taper: 'logarithmic' }],
	} satisfies Record<string, [number, number, { unit: string; step: number; taper: string }]>),
	applyToAllAudio: false,
	fullSpectrumOnly: true,
});

export function normalizeMatchEqProfile(value: unknown): MatchEqProfile {
	if (!value || typeof value !== 'object') throw new TypeError('Invalid Match EQ reference profile.');
	if (ownedProfiles.has(value as MatchEqProfile)) return value as MatchEqProfile;
	const profile = value as Partial<MatchEqProfile>;
	const { version, sampleRate, activeSeconds, bands: input } = profile;
	if (version !== 1 || !Number.isInteger(sampleRate) || Number(sampleRate) < 8000
		|| Number(sampleRate) > 384000 || !Number.isFinite(activeSeconds) || Number(activeSeconds) <= 0
		|| !Array.isArray(input) || input.length !== MATCH_EQ_FREQUENCIES.length) {
		throw new RangeError('Invalid Match EQ reference profile.');
	}
	const bands = Array.from(input);
	if (bands.length !== MATCH_EQ_FREQUENCIES.length
		|| bands.some((db: unknown) => typeof db !== 'number' || !Number.isFinite(db) || db < -120 || db > 0)) {
		throw new RangeError('Invalid Match EQ reference profile.');
	}
	const normalized = Object.freeze({ version, sampleRate: sampleRate!, activeSeconds: activeSeconds!, bands: Object.freeze(bands) });
	ownedProfiles.add(normalized);
	return normalized;
}

export function normalizeMatchEqParams(params: Readonly<Record<string, unknown>> = {}): MatchEqParams {
	const values: Record<string, number> = {};
	for (const [name, [minimum, maximum]] of Object.entries(MATCH_EQ_EFFECT_DEFINITION.ranges)) {
		const value = Number(params[name] ?? MATCH_EQ_EFFECT_DEFINITION.defaults[name as keyof typeof MATCH_EQ_EFFECT_DEFINITION.ranges]);
		if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
		values[name] = value;
	}
	if (values.minimumFrequency! >= values.maximumFrequency!) throw new RangeError('The matching frequency range must increase.');
	return { reference: params.reference == null ? null : normalizeMatchEqProfile(params.reference),
		amount: values.amount!, smoothing: values.smoothing!, maxGainDb: values.maxGainDb!,
		minimumFrequency: values.minimumFrequency!, maximumFrequency: values.maximumFrequency! };
}
