/* SPDX-License-Identifier: AGPL-3.0-only */

import { addRationals, subtractRationals, multiplyRationals, divideRationals, compareRationals, roundRational, type Rational } from './timeline-time.ts';
import { rationalFromDouble } from './dawproject-format.ts';

export interface InterchangeMidiTempo { readonly beat: number; readonly bpm: number }

/** Stepped quarter-note tempo, shared by the source-format readers. */
export function createInterchangeMidiClock(tempos: readonly InterchangeMidiTempo[]) {
	if (!tempos.length || tempos[0]!.beat !== 0) throw new RangeError('MIDI tempo map must start at beat zero.');
	let seconds: Rational = { num: 0, den: 1 };
	const points = tempos.map((tempo, index) => {
		if (!Number.isFinite(tempo.beat) || tempo.beat < 0 || !Number.isFinite(tempo.bpm) || tempo.bpm <= 0 || tempo.bpm > 1000
			|| index > 0 && tempo.beat <= tempos[index - 1]!.beat) throw new RangeError('Invalid MIDI tempo map.');
		if (index) seconds = addRationals(seconds, multiplyRationals(rationalFromDouble(tempo.beat - tempos[index - 1]!.beat),
			divideRationals(60, rationalFromDouble(tempos[index - 1]!.bpm))));
		return { ...tempo, seconds, secondsPerBeat: divideRationals(60, rationalFromDouble(tempo.bpm)) };
	});
	function atBeat(beat: number): Rational {
		if (!Number.isFinite(beat)) throw new RangeError('Invalid MIDI beat.');
		const point = points[find(point => point.beat <= beat)]!;
		return addRationals(point.seconds, multiplyRationals(rationalFromDouble(beat - point.beat), point.secondsPerBeat));
	}
	function beatAt(time: Rational): number {
		const point = points[find(point => compareRationals(point.seconds, time) <= 0)]!;
		const delta = divideRationals(subtractRationals(time, point.seconds), point.secondsPerBeat);
		return point.beat + delta.num / delta.den;
	}
	function find(before: (point: typeof points[number]) => boolean): number {
		let low = 0, high = points.length;
		while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (before(points[middle]!)) low = middle; else high = middle; }
		return low;
	}
	function frameAt(beat: number, sampleRate: number, origin: Rational = { num: 0, den: 1 }): number {
		const value = multiplyRationals(subtractRationals(atBeat(beat), origin), sampleRate);
		return roundRational(value.num, value.den, 'point');
	}
	return { atBeat, beatAt, frameAt };
}
