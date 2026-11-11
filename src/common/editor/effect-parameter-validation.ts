/* SPDX-License-Identifier: AGPL-3.0-only */

export function effectParameterChoice<Option>(value: unknown, options: readonly Option[], name: string): Option {
	const match = options.find(option => String(option) === String(value));
	if (match === undefined) throw new RangeError(`${name} is not a supported option.`);
	return match;
}

export function effectParameterRange(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}
