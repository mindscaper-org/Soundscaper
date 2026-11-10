/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUTO_TUNE_KEYS = Object.freeze(['c', 'c-sharp', 'd', 'd-sharp', 'e', 'f', 'f-sharp', 'g', 'g-sharp', 'a', 'a-sharp', 'b'] as const);
export type AutoTuneKey = typeof AUTO_TUNE_KEYS[number];
export type AutoTuneScale = 'chromatic' | 'major' | 'minor';
export interface AutoTuneParams {
	readonly amount: number;
	readonly retune: number;
	readonly mix: number;
	readonly key: AutoTuneKey;
	readonly scale: AutoTuneScale;
}

export const AUTO_TUNE_EFFECT_DEFINITION = Object.freeze({
	defaults: Object.freeze({ amount: 100, retune: 20, mix: 100, key: 'c', scale: 'chromatic' }),
	ranges: Object.freeze({
		amount: [0, 100, { unit: '%', step: 1, taper: 'linear' }],
		retune: [0, 500, { unit: 'ms', step: 1, taper: 'linear' }],
		mix: [0, 100, { unit: '%', step: 1, taper: 'linear' }],
	} satisfies Record<string, [number, number, { unit: string; step: number; taper: string }]>),
	choices: Object.freeze({
		key: Object.freeze({ options: AUTO_TUNE_KEYS }),
		scale: Object.freeze({ options: Object.freeze(['chromatic', 'major', 'minor'] as const) }),
	}),
});

export function normalizeAutoTuneParams(params: Readonly<Record<string, unknown>> = {}): AutoTuneParams {
	const definition = AUTO_TUNE_EFFECT_DEFINITION;
	const numbers = { amount: 100, retune: 20, mix: 100 };
	for (const key of ['amount', 'retune', 'mix'] as const) {
		const value = Number(params[key] ?? definition.defaults[key]);
		const [minimum, maximum] = definition.ranges[key];
		if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`auto-tune.${key} must be between ${minimum} and ${maximum}.`);
		numbers[key] = value;
	}
	const key = params.key ?? definition.defaults.key;
	const scale = params.scale ?? definition.defaults.scale;
	if (!AUTO_TUNE_KEYS.some(option => option === key)) throw new RangeError('auto-tune.key is not a supported option.');
	if (!definition.choices.scale.options.some(option => option === scale)) throw new RangeError('auto-tune.scale is not a supported option.');
	return { ...numbers, key: key as AutoTuneKey, scale: scale as AutoTuneScale };
}
