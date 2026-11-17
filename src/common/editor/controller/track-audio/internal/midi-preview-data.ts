/* SPDX-License-Identifier: AGPL-3.0-only */
import { splitMidiInstrumentPorts } from '../../../engine/midi-instrument-ports.ts';
import { readMidiClip, type MidiClipData, type MidiPreviewTarget } from '../../../midi-model.ts';

/** Restore the selected voice's destination and setup, without sounding other keys. */
export function midiPreviewData(clips: readonly unknown[], target: MidiPreviewTarget, pitch: number): MidiClipData {
	const clip = clips.find(value => value && typeof value === 'object' && 'id' in value && value.id === target.clipId);
	const data = readMidiClip(clip);
	if (!data) throw new ReferenceError('The MIDI preview clip is missing.');
	const noteId = target.noteId ?? data.notes[0]?.id;
	const parts = splitMidiInstrumentPorts(data);
	const part = parts.find(part => part.notes.some(note => note.id === noteId)) ?? parts[0];
	const note = part?.notes.find(note => note.id === noteId);
	if (target.noteId && !note) throw new ReferenceError('The MIDI preview note is missing.');
	const channel = note?.channel ?? 0, origin = note?.startFrame ?? 0;
	return { version: 1, notes: [{ id: 'preview', pitch, velocity: 100, channel, startFrame: 0, durationFrames: 1 }],
		interchange: { tempos: [], signatures: [], events: (part ?? data).interchange?.events
			.filter(event => event.frame <= origin && event.status >= 0x80 && event.status < 0xf0
				&& (event.status & 15) === channel && ![0x80, 0x90].includes(event.status & 0xf0))
			.map(event => ({ ...event, frame: 0 })) ?? [] } };
}
