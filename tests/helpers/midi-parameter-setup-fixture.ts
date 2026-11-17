/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileDocument, MidiFileEvent } from '../../src/common/editor/midi-file-types.ts';

export function midiPitchRangeSetup(changing = false): MidiFileDocument {
	const range = (frame: number, semitones: number): MidiFileEvent[] => [
		{ frame, status: 176, data: [101, 0] }, { frame, status: 176, data: [100, 0] }, { frame, status: 176, data: [6, semitones] },
	];
	return { sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Recorded pitch range', durationFrames: 16000,
		notes: [{ id: 'held', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 15000 }],
		events: [...range(0, changing ? 2 : 12), { frame: 0, status: 224, data: [127, 127] }, ...(changing ? range(8000, 12) : [])],
	}] };
}
