/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeRational, type Rational } from './timeline-time.ts';
/** Explicit six-decimal frame/second boundary for AE floating clocks; callers must report quantization. */
export function motionAeBoundedClock(value: number): Readonly<{ value: Rational; quantized: boolean }> {
	const numerator = Math.round(value * 1_000_000);
	if (!Number.isSafeInteger(numerator)) throw new RangeError('AE clock exceeds the bounded conversion range.');
	const rational = normalizeRational({ num: numerator, den: 1_000_000 });
	return { value: rational, quantized: rational.num / rational.den !== value };
}

/** Recover host NTSC clocks without treating nearby custom decimal rates as NTSC labels. */
export function motionAeFrameRate(value: number): Readonly<{ value: Rational; quantized: boolean }> {
	if (!Number.isFinite(value) || value < 1 || value > 1000) throw new RangeError('AE composition frame rate is outside its finite range.');
	for (const numerator of [24_000, 30_000, 48_000, 60_000, 120_000]) {
		const exact = numerator / 1001;
		if (Math.abs(value - exact) <= Number.EPSILON * exact * 4) return { value: { num: numerator, den: 1001 }, quantized: value !== exact };
	}
	return motionAeBoundedClock(value);
}
