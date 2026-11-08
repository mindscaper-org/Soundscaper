/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SnapGrid } from '@audacity-ui/core';

export interface PianoRollMusicalTick {
	readonly time: number;
	readonly bar: boolean;
	readonly label: string;
}

/** Source seconds stay the geometry; a host can supply its authored musical clock. */
export interface PianoRollMusicalClock {
	beatAtTime(seconds: number): number;
	timeAtBeat(quarterBeat: number): number;
	ticks(start: number, end: number, pixelsPerSecond: number): readonly PianoRollMusicalTick[];
}

export function pianoRollGridMath(bpm: number, snap: SnapGrid, clock?: PianoRollMusicalClock) {
	const subdivisions = snap.subdivision * (snap.triplet ? 1.5 : 1);
	const beatDuration = 60 / bpm;
	const snapTime = (time: number): number => clock
		? clock.timeAtBeat(Math.round(clock.beatAtTime(time) * subdivisions) / subdivisions)
		: Math.round(time / (beatDuration / subdivisions)) * (beatDuration / subdivisions);
	const durationAt = (start: number, beats = 1 / subdivisions): number => clock
		? clock.timeAtBeat(clock.beatAtTime(start) + beats) - start
		: beats === 1 / subdivisions ? beatDuration / subdivisions : beatDuration * beats;
	const durationEndingAt = (end: number, beats: number): number => clock
		? end - clock.timeAtBeat(Math.max(0, clock.beatAtTime(end) - beats)) : beatDuration * beats;
	const snapDuration = (start: number, duration: number): number => {
		if (!clock) return snapTime(duration);
		const origin = clock.beatAtTime(start);
		const beats = clock.beatAtTime(start + duration) - origin;
		return clock.timeAtBeat(origin + Math.round(beats * subdivisions) / subdivisions) - start;
	};
	return { snapTime, durationAt, durationEndingAt, snapDuration };
}
