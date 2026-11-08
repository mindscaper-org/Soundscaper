/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AllegroTempoDeclaration } from './allegro-file-anchors.ts';
import type { MidiFileTempo } from './midi-file-types.ts';

/** Merge authored beat and second positions before converting beat-positioned notes. */
export function resolveAllegroTempoClock(tempos: readonly AllegroTempoDeclaration[], sampleRate: number): MidiFileTempo[] {
	if (!tempos.some(tempo => tempo.beat !== undefined)) return tempos.map(({ frame, bpm }) => ({ frame, bpm }));
	const seconds = tempos.filter(tempo => tempo.beat === undefined).sort((a, b) => a.frame - b.frame || a.order - b.order);
	const beats = tempos.filter(tempo => tempo.beat !== undefined).sort((a, b) => a.beat! - b.beat! || a.order - b.order);
	const result: MidiFileTempo[] = [];
	let secondIndex = 0, beatIndex = 0;
	let frame = 0, beat = 0, bpm = 100;
	while (secondIndex < seconds.length || beatIndex < beats.length) {
		const nextSecond = seconds[secondIndex], nextBeat = beats[beatIndex];
		const beatFrame = nextBeat ? frame + (nextBeat.beat! - beat) / bpm * 60 * sampleRate : Infinity;
		const useSeconds = nextSecond !== undefined && (!nextBeat || nextSecond.frame < beatFrame
			|| nextSecond.frame === beatFrame && nextSecond.order < nextBeat.order);
		const next = useSeconds ? nextSecond! : nextBeat!;
		const nextFrame = useSeconds ? next.frame : beatFrame;
		beat = useSeconds ? beat + (nextFrame - frame) / sampleRate * bpm / 60 : next.beat!;
		frame = nextFrame; bpm = next.bpm;
		result.push({ frame, bpm });
		if (useSeconds) secondIndex += 1;
		else beatIndex += 1;
	}
	return result;
}

/** A provisional clock must never silently become the final note clock. */
export function sameAllegroTempoClock(left: readonly MidiFileTempo[], right: readonly MidiFileTempo[]): boolean {
	return left.length === right.length && left.every((tempo, index) => tempo.bpm === right[index]!.bpm
		&& Math.abs(tempo.frame - right[index]!.frame) <= 1e-7);
}

interface EventClock {
	frameToBeat(frame: number): number;
	beatToFrame(beat: number): number;
}

/** Later source clock updates preserve the beat identity of events already read. */
export function createAllegroEventClockValidation() {
	const source = new Map<string, Readonly<{ frame: number; beat: number; keyPart: boolean }>>();
	const output = new Map<string, number>();
	const sourceKeys = new Set<string>(), outputKeys = new Set<string>();
	const refuse = (): never => { throw new RangeError('Allegro earlier events require clock retiming that this import cannot retain. Move conductor declarations before affected events or import MIDI.'); };
	return {
		position(id: string, frame: number, materialize: boolean, timing: EventClock, keyPart = false): void {
			if (materialize) output.set(id, frame);
			else source.set(id, { frame, beat: timing.frameToBeat(frame), keyPart });
		},
		completeKeys(ids: readonly string[], materialize: boolean): void {
			for (const id of ids) (materialize ? outputKeys : sourceKeys).add(id);
		},
		assertRetained(timing: EventClock, offset: number): void {
			if (sourceKeys.size !== outputKeys.size || [...sourceKeys].some(id => !outputKeys.has(id))) refuse();
			for (const [id, point] of source) {
				if (point.keyPart && !sourceKeys.has(id)) continue;
				const frame = output.get(id);
				// A point already on the final clock keeps its original precision.
				const expected = timing.frameToBeat(point.frame) === point.beat ? point.frame : timing.beatToFrame(point.beat);
				if (frame === undefined || Math.round(expected + offset) !== Math.round(frame + offset)) {
					refuse();
				}
			}
		},
	};
}
