/* SPDX-License-Identifier: AGPL-3.0-only */

import { iirReleaseBoundFrames, type NormalizedIirCoefficients } from '../standard/filters-coefficients.ts';

type Range = readonly [number, number, {
	readonly unit: string; readonly step: number; readonly taper: string;
	readonly integer: boolean; readonly automatable: false; readonly automationBlockReason: string;
}];

function range(minimum: number, maximum: number, unit: string, step: number, taper = 'linear', integer = false): Range {
	return [minimum, maximum, { unit, step, taper, integer, automatable: false,
		automationBlockReason: 'This processor supports live controls but not timeline automation.' }];
}

export const HUM_REMOVAL_MAXIMUM_HARMONICS = 32;
export const HUM_REMOVAL_EFFECT_DEFINITION = Object.freeze({
	defaults: Object.freeze({ frequency: 50, harmonics: 8, bandwidth: 2, reduction: 24 }),
	ranges: Object.freeze({
		frequency: range(20, 400, 'Hz', .1, 'logarithmic'),
		harmonics: range(1, HUM_REMOVAL_MAXIMUM_HARMONICS, '', 1, 'linear', true),
		bandwidth: range(.5, 20, 'Hz', .1, 'logarithmic'),
		reduction: range(0, 60, 'dB', .1, 'decibel'),
	}),
});

export interface HumRemovalParams {
	readonly frequency: number;
	readonly harmonics: number;
	readonly bandwidth: number;
	readonly reduction: number;
}

export function normalizeHumRemovalParams(params: Readonly<Record<string, unknown>>): HumRemovalParams {
	const value = (key: keyof HumRemovalParams): number => {
		const [minimum, maximum, metadata] = HUM_REMOVAL_EFFECT_DEFINITION.ranges[key];
		const number = Number(params[key] ?? HUM_REMOVAL_EFFECT_DEFINITION.defaults[key]);
		if (!Number.isFinite(number) || number < minimum || number > maximum) {
			throw new RangeError(`hum-removal.${key} must be between ${minimum} and ${maximum}.`);
		}
		return metadata.integer ? Math.round(number) : number;
	};
	return { frequency: value('frequency'), harmonics: value('harmonics'), bandwidth: value('bandwidth'), reduction: value('reduction') };
}

function validateRate(sampleRate: number): void {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
		throw new RangeError('The sample rate must be between 8000 and 384000 Hz.');
	}
}

/** Each section blends a unity-gain notch with dry audio to set its finite
 * attenuation. The bilinear bandwidth gives the same width in Hz at every
 * harmonic; the fundamental counts as the first harmonic. No source plug-in
 * code is used. See the notch equations in https://www.w3.org/TR/audio-eq-cookbook/.
 */
export function humRemovalCoefficients(params: HumRemovalParams, sampleRate: number): readonly NormalizedIirCoefficients[] {
	validateRate(sampleRate);
	if (params.reduction === 0) return [];
	const alpha = Math.tan(Math.PI * params.bandwidth / sampleRate);
	const denominator = 1 + alpha;
	const gain = 10 ** (-params.reduction / 20);
	const coefficients: NormalizedIirCoefficients[] = [];
	for (let harmonic = 1; harmonic <= params.harmonics; harmonic++) {
		const frequency = params.frequency * harmonic;
		// Omit sections whose nominal band reaches Nyquist instead of folding
		// them onto lower audio frequencies at small project sample rates.
		if (frequency + params.bandwidth / 2 >= sampleRate / 2) break;
		const cosine = -2 * Math.cos(2 * Math.PI * frequency / sampleRate) / denominator;
		coefficients.push([(1 + gain * alpha) / denominator, cosine,
			(1 - gain * alpha) / denominator, cosine, (1 - alpha) / denominator]);
	}
	return coefficients;
}

export function humRemovalTailSeconds(params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	const normalized = normalizeHumRemovalParams(params);
	const coefficients = humRemovalCoefficients(normalized, sampleRate);
	return coefficients.length ? iirReleaseBoundFrames(coefficients) / sampleRate : 0;
}

/** Reserve active, crossfading and latest queued banks, including a larger old
 * configuration after the number of harmonics has been reduced live.
 */
export function humRemovalStateBytes(params: Readonly<Record<string, unknown>>, sampleRate: number, channels: number): number {
	normalizeHumRemovalParams(params);
	validateRate(sampleRate);
	if (!Number.isInteger(channels) || channels < 1 || channels > 32) throw new RangeError('channelCount must be between 1 and 32.');
	return 3 * HUM_REMOVAL_MAXIMUM_HARMONICS * (channels * 2 + 5) * Float64Array.BYTES_PER_ELEMENT;
}
