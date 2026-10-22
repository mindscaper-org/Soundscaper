/* SPDX-License-Identifier: AGPL-3.0-only */

import { roundRational } from './timeline-time.ts';

/** File decimals state exact times; binary multiplication can move half a sample. */
export function labelTimeFrame(value: string, sampleRate: number): number | null {
	const match = value.trim().match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u);
	if (!match || !(match[2] || match[3])) return null;
	const fraction = match[3] ?? '';
	let digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/u, '');
	if (digits === '') return 0;
	if (match[1] === '-') return null;
	const significant = digits.replace(/0+$/u, '');
	const exponent = Number(match[4] ?? 0) - fraction.length + digits.length - significant.length;
	digits = significant;
	if (exponent + digits.length + String(sampleRate).length < 0) return 0;
	// Bound precision work independently of the reader's total text limit.
	if (digits.length > 512 || !Number.isSafeInteger(exponent) || exponent > 512 || exponent < -1_024) return null;
	const numerator = BigInt(digits) * BigInt(sampleRate) * (exponent > 0 ? 10n ** BigInt(exponent) : 1n);
	const denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
	try { return roundRational(numerator, denominator, 'point'); }
	catch (error) { if (error instanceof RangeError) return null; throw error; }
}
