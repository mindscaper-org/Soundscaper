/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from './closed-domain-value.ts';
import type { Rational } from './timeline-time.ts';

/** A reduced proper fraction of one canonical microsecond, omitted when zero. */
export interface TimelineImageSourceFraction {
	readonly num: string;
	readonly den: string;
}

export interface TimelineImageSourcePhase {
	readonly sourceStartTicks: string;
	readonly sourceStartFraction?: TimelineImageSourceFraction;
}

const INTEGER = /^(?:0|[1-9][0-9]{0,511})$/u;

export function normalizeTimelineImageSourceFraction(value: unknown): TimelineImageSourceFraction {
	const record = readClosedDomainRecord(value, 'Image source tick fraction', ['num', 'den']);
	const num = integer(readClosedDomainField(record, 'num', 'Image source tick fraction'));
	const den = integer(readClosedDomainField(record, 'den', 'Image source tick fraction'));
	if (num <= 0n || num >= den || gcd(num, den) !== 1n) {
		throw new RangeError('An image source tick fraction must be nonzero, proper and reduced.');
	}
	return Object.freeze({ num: String(num), den: String(den) });
}

/** Keep the fractional tick until the final frame address is resolved. */
export function advanceTimelineImageSourcePhase(phase: TimelineImageSourcePhase, frames: number,
	rate: Rational, finalTick?: bigint): TimelineImageSourcePhase {
	const { num: numerator, den: denominator } = advanced(phase, frames, rate);
	if (numerator < 0n) throw new RangeError('An image source phase cannot precede its source.');
	if (finalTick !== undefined && numerator > finalTick * denominator) {
		return Object.freeze({ sourceStartTicks: String(finalTick) });
	}
	const ticks = numerator / denominator;
	const remainder = numerator % denominator;
	if (remainder === 0n) return Object.freeze({ sourceStartTicks: String(ticks) });
	const divisor = gcd(remainder, denominator);
	return Object.freeze({ sourceStartTicks: String(ticks), sourceStartFraction: Object.freeze({
		num: String(remainder / divisor), den: String(denominator / divisor),
	}) });
}

export function timelineImageSourceTickAtFrame(phase: TimelineImageSourcePhase, frames: number, rate: Rational): bigint {
	const value = advanced(phase, frames, rate);
	return value.num / value.den;
}

export function timelineImageAvailableSourceFrames(phase: TimelineImageSourcePhase, rate: Rational): number {
	const current = rational(phase);
	return Number(current.num * BigInt(rate.num) / (current.den * 1_000_000n * BigInt(rate.den)));
}

function rational(phase: TimelineImageSourcePhase): Readonly<{ num: bigint; den: bigint }> {
	const fraction = phase.sourceStartFraction;
	const den = fraction ? BigInt(fraction.den) : 1n;
	return { num: BigInt(phase.sourceStartTicks) * den + (fraction ? BigInt(fraction.num) : 0n), den };
}

function advanced(phase: TimelineImageSourcePhase, frames: number, rate: Rational): Readonly<{ num: bigint; den: bigint }> {
	const current = rational(phase);
	return { num: current.num * BigInt(rate.num)
		+ BigInt(frames) * 1_000_000n * BigInt(rate.den) * current.den, den: current.den * BigInt(rate.num) };
}

function integer(value: unknown): bigint {
	if (typeof value !== 'string' || !INTEGER.test(value)) throw new TypeError('An image phase fraction requires bounded canonical decimal strings.');
	return BigInt(value);
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
	return left;
}
