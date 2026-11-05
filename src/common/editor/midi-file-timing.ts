/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileTempo } from './midi-file-types.ts';

interface TempoSegment {
	readonly frame: number;
	readonly beat: number;
	readonly bpm: number;
}

export function createMidiTempoTimeline(tempos: readonly MidiFileTempo[], sampleRate: number, defaultBpm = 120) {
	const sorted = [...tempos].sort((a, b) => a.frame - b.frame);
	const segments: TempoSegment[] = [{ frame: 0, beat: 0, bpm: defaultBpm }];
	const appendTempo = (tempo: MidiFileTempo): boolean => {
		if (tempo.frame < segments[segments.length - 1]!.frame) return false;
		const previous = segments[segments.length - 1]!;
		const beat = previous.beat + (tempo.frame - previous.frame) / sampleRate * previous.bpm / 60;
		const segment = { ...tempo, beat };
		if (tempo.frame === previous.frame) segments[segments.length - 1] = segment;
		else segments.push(segment);
		return true;
	};
	for (const tempo of sorted) appendTempo(tempo);
	return {
		appendTempo,
		frameToBeat(frame: number): number {
			const segment = findSegment(segments, frame, 'frame');
			return segment.beat + (frame - segment.frame) / sampleRate * segment.bpm / 60;
		},
		beatToFrame(beat: number): number {
			const segment = findSegment(segments, beat, 'beat');
			return segment.frame + (beat - segment.beat) / segment.bpm * 60 * sampleRate;
		},
	};
}

function findSegment(segments: readonly TempoSegment[], value: number, key: 'frame' | 'beat'): TempoSegment {
	let low = 0;
	let high = segments.length;
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2);
		if (segments[middle]![key] <= value) low = middle;
		else high = middle;
	}
	return segments[low]!;
}
