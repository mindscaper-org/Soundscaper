/* SPDX-License-Identifier: AGPL-3.0-only */
import { sequenceTimecodeFromFrameCount, sequenceTimecodeToFrameCount, type SequenceTimecode } from './sequence-timecode.ts';

/** The four wire rates defined by MIDI Time Code. */
export type TimecodeRate = '24' | '25' | '29.97df' | '30';
export const TIMECODE_RATES: readonly TimecodeRate[] = Object.freeze(['24', '25', '29.97df', '30']);
export interface TimecodeReading {
	readonly frame: number;
	readonly rate: TimecodeRate;
	readonly direction: -1 | 0 | 1;
}
export function timecodeRate(rate: TimecodeRate): number {
	if (!TIMECODE_RATES.includes(rate)) throw new RangeError('Unsupported timecode rate.');
	return rate === '29.97df' ? 30000 / 1001 : Number(rate);
}
function rationalRate(rate: TimecodeRate) {
	return rate === '29.97df' ? { num: 30000, den: 1001 } : { num: timecodeRate(rate), den: 1 };
}
export function timecodeDayFrames(rate: TimecodeRate): number {
	return rate === '29.97df' ? 2589408 : timecodeRate(rate) * 86400;
}
export function wrapTimecodeFrame(frame: number, rate: TimecodeRate): number {
	if (!Number.isSafeInteger(frame)) throw new RangeError('Timecode frames must be safe integers.');
	const day = timecodeDayFrames(rate);
	return ((frame % day) + day) % day;
}
export function timecodeFromFrames(frame: number, rate: TimecodeRate): SequenceTimecode {
	return sequenceTimecodeFromFrameCount(wrapTimecodeFrame(frame, rate), rationalRate(rate), rate === '29.97df');
}
export function timecodeToFrames(fields: Omit<SequenceTimecode, 'negative'>, rate: TimecodeRate): number {
	if (!Number.isInteger(fields.hours) || fields.hours < 0 || fields.hours > 23) throw new RangeError('Timecode hours must be between 0 and 23.');
	return sequenceTimecodeToFrameCount({ ...fields, negative: false }, rationalRate(rate), rate === '29.97df');
}
