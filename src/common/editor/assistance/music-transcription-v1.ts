/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileDocument } from '../midi-file-types.ts';
import { scaleSampleFrame } from '../timeline-time.ts';

export type MusicMidiImporter = (document: MidiFileDocument,
	options: Readonly<{ timelineStartFrame: number }>) => Promise<unknown>;

export const MUSIC_TRANSCRIPTION_SAMPLE_RATE = 22_050;
export const MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES = MUSIC_TRANSCRIPTION_SAMPLE_RATE * 30 * 60;
export const MUSIC_TRANSCRIPTION_MAXIMUM_NOTES = 100_000;
export interface TranscribedMusicNoteV1 {
	readonly pitch: number;
	readonly startSample: number;
	readonly durationSamples: number;
	readonly velocity: number;
}
export interface MusicTranscriptionV1 {
	readonly schemaVersion: 1;
	readonly sampleRate: 22_050;
	readonly sampleCount: number;
	readonly notes: readonly TranscribedMusicNoteV1[];
}

/** Re-admit semantic note data independently of the model and native worker. */
export function reviewMusicTranscriptionV1(value: unknown): MusicTranscriptionV1 {
	const row = exact(value, ['schemaVersion', 'sampleRate', 'sampleCount', 'notes']);
	if (row.schemaVersion !== 1 || row.sampleRate !== MUSIC_TRANSCRIPTION_SAMPLE_RATE) throw new TypeError('Unsupported music transcription format.');
	const sampleCount = integer(row.sampleCount, 1, MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES);
	if (!Array.isArray(row.notes) || row.notes.length > MUSIC_TRANSCRIPTION_MAXIMUM_NOTES) throw new RangeError('Music transcription exceeds its note bound.');
	let previousStart = -1;
	const notes = row.notes.map((value: unknown) => {
		const note = exact(value, ['pitch', 'startSample', 'durationSamples', 'velocity']);
		const startSample = integer(note.startSample, 0, sampleCount - 1);
		const durationSamples = integer(note.durationSamples, 1, sampleCount - startSample);
		if (startSample < previousStart) throw new RangeError('Transcribed notes must be ordered by start sample.');
		previousStart = startSample;
		return Object.freeze({ pitch: integer(note.pitch, 0, 127), startSample, durationSamples,
			velocity: integer(note.velocity, 1, 127) });
	});
	return Object.freeze({ schemaVersion: 1, sampleRate: MUSIC_TRANSCRIPTION_SAMPLE_RATE,
		sampleCount, notes: Object.freeze(notes) });
}

export function musicTranscriptionMidiDocument(value: MusicTranscriptionV1, sampleRate: number, name: string): MidiFileDocument {
	const result = reviewMusicTranscriptionV1(value);
	integer(sampleRate, 1, 768_000);
	if (!name.trim() || name.length > 4_096) throw new TypeError('A transcribed MIDI track needs a name.');
	const frame = (sample: number) => Number(scaleSampleFrame(sample, result.sampleRate, sampleRate, 'point'));
	return { sampleRate, tempos: [], signatures: [], tracks: [{ name, durationFrames: frame(result.sampleCount),
		notes: result.notes.map((note, index) => {
			const startFrame = frame(note.startSample);
			return { id: `transcribed-note-${String(index)}`, pitch: note.pitch, velocity: note.velocity, channel: 0,
				startFrame, durationFrames: Math.max(1, frame(note.startSample + note.durationSamples) - startFrame) };
		}) }] };
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid music transcription note or sample geometry.');
	return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new TypeError('Invalid music transcription record.');
	return value as Record<string, unknown>;
}
