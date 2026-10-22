/* SPDX-License-Identifier: AGPL-3.0-only */

/** FCPXML can retain a native media boundary without crossing a frame grid. */
export function fcpxmlRationalTime(numerator: bigint, denominator: bigint): string {
	if (numerator < 0n || denominator <= 0n) throw new RangeError('An FCPXML time requires a non-negative rational.');
	if (numerator === 0n) return '0s';
	let divisor = numerator;
	let remainder = denominator;
	while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
	const reducedNumerator = numerator / divisor;
	const reducedDenominator = denominator / divisor;
	return reducedDenominator === 1n ? `${reducedNumerator}s` : `${reducedNumerator}/${reducedDenominator}s`;
}
