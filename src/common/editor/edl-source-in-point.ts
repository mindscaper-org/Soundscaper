/* SPDX-License-Identifier: AGPL-3.0-only */

import { interchangeSourceInTime } from './interchange-source-in-point.ts';
import { sequenceTimecodeToFrameCount, type SequenceRationalRate } from './sequence-timecode.ts';
import { roundRational } from './timeline-time.ts';

/** EDL source addresses are tape timecode, including the camera's media origin. */
export function edlSourceInPoint(
	clip: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>> | undefined,
	rate: SequenceRationalRate,
	sampleRate: number,
): number {
	const trim = interchangeSourceInTime(clip, source, sampleRate);
	const characteristics = record(source?.characteristics);
	const origin = record(characteristics?.startTimecode);
	if (!origin) return roundRational(trim.numerator * BigInt(rate.num), trim.denominator * BigInt(rate.den), 'point');
	const sourceRate = record(source?.frameRate);
	const num = Number(sourceRate?.num);
	const den = Number(sourceRate?.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
		throw new TypeError('A camera timecode origin requires an exact source frame rate.');
	}
	const originFrames = sequenceTimecodeToFrameCount({
		negative: origin.negative === true,
		hours: Number(origin.hours), minutes: Number(origin.minutes),
		seconds: Number(origin.seconds), frames: Number(origin.frames),
	}, { num, den }, origin.dropFrame === true);
	const numerator = trim.numerator * BigInt(num) + BigInt(originFrames) * BigInt(den) * trim.denominator;
	return roundRational(numerator * BigInt(rate.num), trim.denominator * BigInt(num) * BigInt(rate.den), 'point');
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>> : null;
}
