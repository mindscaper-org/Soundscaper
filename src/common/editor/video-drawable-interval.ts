/* SPDX-License-Identifier: AGPL-3.0-only */

type DrawableInterval = Readonly<{
	readonly drawableSourceStartTime?: unknown;
	readonly drawableSourceEndTime?: unknown;
}>;

/** A browser seek near the start stays clear of nearest-picture rounding. */
export function browserVideoFrameSeekSeconds(start: number, end: number): number {
	const target = start + (end - start) / 4;
	return target >= start && target < end ? target : start;
}

/** Choose a browser seek inside a drawable frame's half-open exact-time interval. */
export function drawableVideoIntervalInteriorSeconds(
	descriptor: DrawableInterval,
	options: Readonly<{ allowArrayRationals?: boolean }> = {},
): number | null {
	const allowArrayRationals = options.allowArrayRationals === true;
	const start = optionalExactSeconds(descriptor.drawableSourceStartTime, allowArrayRationals);
	const end = optionalExactSeconds(descriptor.drawableSourceEndTime, allowArrayRationals);
	if (start === null || end === null || !(start < end)) return null;
	return browserVideoFrameSeekSeconds(start, end);
}

function optionalExactSeconds(value: unknown, allowArrayRationals: boolean): number | null {
	if (!value || typeof value !== 'object' || (!allowArrayRationals && Array.isArray(value))) return null;
	const rational = value as Readonly<{ numerator?: unknown; denominator?: unknown }>;
	if (typeof rational.numerator !== 'bigint' || typeof rational.denominator !== 'bigint'
		|| rational.denominator <= 0n) return null;
	const result = Number(rational.numerator) / Number(rational.denominator);
	return Number.isFinite(result) ? result : null;
}
