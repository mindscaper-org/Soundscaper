/* SPDX-License-Identifier: AGPL-3.0-only */
import { sequenceTimecodeFromFrameCount, sequenceTimecodeToFrameCount } from './sequence-timecode.ts';
import type { Rational } from './timeline-time.ts';

/** Deliberately bounded legacy TCF profile; unsupported clocks are never approximated. */
export interface AdlClock {
	readonly sampleRate: number;
	readonly rate: Rational;
	readonly dropFrame: boolean;
}

export function assertAdlClock(clock: AdlClock): void {
	if (![44_100, 48_000].includes(clock.sampleRate)) throw new RangeError('ADL supports 44100 and 48000 Hz sample rates.');
	if (!(clock.rate.den === 1 && [24, 25, 30].includes(clock.rate.num) && !clock.dropFrame)
		&& !(clock.rate.num === 30_000 && clock.rate.den === 1001 && clock.dropFrame)) {
		throw new RangeError('ADL supports 24, 25, 30 NDF and 30000/1001 DF frame rates.');
	}
}

/** AES31 frame boundaries use the integral sample at or before the exact boundary. */
function boundary(frame: number, clock: AdlClock): number {
	return Number(BigInt(frame) * BigInt(clock.sampleRate) * BigInt(clock.rate.den) / BigInt(clock.rate.num));
}

export function parseAdlTime(text: string, clock: AdlClock): number {
	assertAdlClock(clock);
	const match = /^(\d{2})([.:=|])(\d{2})([.:=|])(\d{2})([.:=|,])(\d{2})([/|])(\d{4})$/u.exec(text);
	if (!match || Number(match[1]) > 23) throw new TypeError(`Invalid ADL timecode: ${text}.`);
	const frame = sequenceTimecodeToFrameCount({ negative: false, hours: Number(match[1]), minutes: Number(match[3]),
		seconds: Number(match[5]), frames: Number(match[7]) }, clock.rate, clock.dropFrame);
	const separator = clock.dropFrame ? ':' : clock.rate.num === 24 ? '=' : clock.rate.num === 25 ? '.' : '|';
	if (match[2] !== separator || match[4] !== separator || match[6] !== (clock.dropFrame ? ',' : separator)
		|| match[8] !== (clock.sampleRate === 44_100 ? '|' : '/')) throw new RangeError('ADL timecode indicators disagree with its clock.');
	const remainder = Number(match[9]);
	if (remainder >= boundary(frame + 1, clock) - boundary(frame, clock)) throw new RangeError('ADL sample remainder exceeds its frame.');
	return boundary(frame, clock) + remainder;
}

export function formatAdlTime(samples: number, clock: AdlClock): string {
	assertAdlClock(clock);
	if (!Number.isSafeInteger(samples) || samples < 0) throw new RangeError('ADL sample positions must be nonnegative safe integers.');
	let frame = Number(BigInt(samples) * BigInt(clock.rate.num) / (BigInt(clock.sampleRate) * BigInt(clock.rate.den)));
	if (boundary(frame + 1, clock) <= samples) frame++;
	const tc = sequenceTimecodeFromFrameCount(frame, clock.rate, clock.dropFrame);
	if (tc.hours > 23) throw new RangeError('ADL timecode exceeds the 24-hour profile limit.');
	const separator = clock.dropFrame ? ':' : clock.rate.num === 24 ? '=' : clock.rate.num === 25 ? '.' : '|';
	const pad = (value: number, width = 2) => String(value).padStart(width, '0');
	return `${pad(tc.hours)}${separator}${pad(tc.minutes)}${separator}${pad(tc.seconds)}${clock.dropFrame ? ',' : separator}${pad(tc.frames)}${clock.sampleRate === 44_100 ? '|' : '/'}${pad(samples - boundary(frame, clock), 4)}`;
}

export function adlClockFromText(sampleRate: string, frameRate: string): AdlClock {
	const fractional = frameRate === '29.97' || frameRate === '30000/1001';
	const clock = { sampleRate: Number(sampleRate.replace(/^S/u, '')), rate: fractional ? { num: 30_000, den: 1001 } : { num: Number(frameRate), den: 1 }, dropFrame: fractional };
	assertAdlClock(clock);
	return clock;
}
