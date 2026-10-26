/* SPDX-License-Identifier: AGPL-3.0-only */

import { interchangeError, timeUnitsToFrame } from './video-caption-interchange-contract-v27.ts';

interface ExactTime { readonly numerator: bigint; readonly denominator: bigint }

/** TTML descendant offsets add to their parent's exact origin before quantization. */
export function parseImscTime(value: string, tickRate: number, sampleRate: number, baseValue?: string): {
	readonly frame: number; readonly exact: boolean;
} {
	const time = exactImscTime(value, tickRate);
	const base = baseValue === undefined ? { numerator: 0n, denominator: 1n } : exactImscTime(baseValue, tickRate);
	return timeUnitsToFrame(time.numerator * base.denominator + base.numerator * time.denominator,
		time.denominator * base.denominator, sampleRate);
}

function exactImscTime(value: string, tickRate: number): ExactTime {
	const ticks = value.match(/^(\d+)t$/u);
	if (ticks) {
		if (tickRate === 0) throw interchangeError('IMSC tick timing requires ttp:tickRate.', 'UNSUPPORTED_PROFILE');
		return { numerator: BigInt(ticks[1] ?? 0), denominator: BigInt(tickRate) };
	}
	const clock = value.match(/^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?$/u);
	if (!clock) throw interchangeError(`Unsupported IMSC time expression: ${value}.`, 'INVALID_TIMING');
	const fraction = clock[4] ?? '';
	const denominator = 10n ** BigInt(fraction.length);
	const seconds = (BigInt(clock[1] ?? 0) * 60n + BigInt(clock[2] ?? 0)) * 60n + BigInt(clock[3] ?? 0);
	return { numerator: seconds * denominator + BigInt(fraction || 0), denominator };
}
