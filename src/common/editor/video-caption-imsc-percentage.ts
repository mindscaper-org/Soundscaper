/* SPDX-License-Identifier: AGPL-3.0-only */

/** TTML length percentages use decimal numbers, never JavaScript exponent notation. */
export function imscPercentage(value: number): string {
	if (!Number.isFinite(value) || value < 0) throw new RangeError('An IMSC percentage must be finite and non-negative.');
	const text = String(value);
	const [coefficient = '', exponent] = text.split('e');
	if (exponent === undefined) return `${text}%`;
	const [integer = '', fraction = ''] = coefficient.split('.');
	const digits = integer + fraction;
	const position = integer.length + Number(exponent);
	const decimal = position <= 0 ? `0.${'0'.repeat(-position)}${digits}`
		: position >= digits.length ? digits + '0'.repeat(position - digits.length)
			: `${digits.slice(0, position)}.${digits.slice(position)}`;
	return `${decimal}%`;
}
