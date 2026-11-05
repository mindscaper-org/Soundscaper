/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileEvent, MidiFileSignature, MidiFileTempo } from './midi-file-types.ts';

export const MIDI_EXTENSION_KEY = 'soundscaper.midi';
export const MIDI_INSTRUMENTS = ['sine', 'triangle', 'square', 'sawtooth'] as const;
export const MIDI_MAXIMUM_NOTES = 200_000;
export type MidiInstrument = typeof MIDI_INSTRUMENTS[number];

/** Note coordinates are in the fallback source's sample-frame space. */
export interface MidiNote {
	readonly id: string;
	readonly pitch: number;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly velocity: number;
	/** Release velocity retained from MIDI note-off messages. */
	readonly releaseVelocity?: number;
	/** Zero-based MIDI channel, 0–15. */
	readonly channel: number;
}

export interface MidiClipInterchange {
	readonly events: readonly MidiFileEvent[];
	readonly tempos: readonly MidiFileTempo[];
	readonly signatures: readonly MidiFileSignature[];
}

export interface MidiClipData {
	readonly version: 1;
	readonly notes: readonly MidiNote[];
	readonly interchange?: MidiClipInterchange;
}

export interface MidiTrackData {
	readonly version: 1;
	readonly instrument: MidiInstrument;
	/** The original zero-based program is retained for MIDI interchange. */
	readonly program?: number;
}

type Carrier = Readonly<Record<string, unknown>>;
const ABSENT_MIDI_DATA = Symbol('absent-midi-data');

/** Read editable MIDI data without changing the audio fallback or unrelated extensions. */
export function readMidiClip(value: unknown): MidiClipData | null {
	const data = carrierData(value);
	if (data === ABSENT_MIDI_DATA) return null;
	if (record(value, 'MIDI clip').kind !== 'audio') throw new TypeError('A MIDI clip requires an audio fallback.');
	return normalizeMidiClipData(data);
}

export function readMidiTrack(value: unknown): MidiTrackData | null {
	const data = carrierData(value);
	if (data === ABSENT_MIDI_DATA) return null;
	if (record(value, 'MIDI track').type !== 'audio') throw new TypeError('A MIDI track requires an audio track fallback.');
	return normalizeMidiTrackData(data);
}

export function isMidiClip(value: unknown): boolean {
	try { return readMidiClip(value) !== null; } catch { return false; }
}

export function isMidiTrack(value: unknown): boolean {
	try { return readMidiTrack(value) !== null; } catch { return false; }
}

export function withMidiClipData<Value extends Carrier>(value: Value, data: MidiClipData): Value {
	return withCarrierData(value, normalizeMidiClipData(data));
}

export function withMidiTrackData<Value extends Carrier>(value: Value, data: MidiTrackData): Value {
	return withCarrierData(value, normalizeMidiTrackData(data));
}

/** A destructive audio edit makes its resulting waveform the authoritative content. */
export function removeMidiClipData<Value extends Carrier>(value: Value): Value {
	const extensions = value.opaqueExtensions === undefined ? {} : record(value.opaqueExtensions, 'opaqueExtensions');
	if (!Object.hasOwn(extensions, MIDI_EXTENSION_KEY)) return value;
	const retained = { ...extensions };
	delete retained[MIDI_EXTENSION_KEY];
	return { ...value, opaqueExtensions: retained };
}

export function normalizeMidiNote(value: unknown): MidiNote {
	const input = record(value, 'MIDI note');
	if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 512) {
		throw new TypeError('MIDI note.id must be a non-empty bounded string.');
	}
	const startFrame = integer(input.startFrame, 0, Number.MAX_SAFE_INTEGER, 'MIDI note.startFrame');
	const durationFrames = integer(input.durationFrames, 1, Number.MAX_SAFE_INTEGER, 'MIDI note.durationFrames');
	if (!Number.isSafeInteger(startFrame + durationFrames)) throw new RangeError('MIDI note end exceeds the frame range.');
	return {
		id: input.id,
		pitch: integer(input.pitch, 0, 127, 'MIDI note.pitch'),
		startFrame,
		durationFrames,
		velocity: integer(input.velocity, 0, 127, 'MIDI note.velocity'),
		...(input.releaseVelocity === undefined ? {} : { releaseVelocity: integer(input.releaseVelocity, 0, 127, 'MIDI note.releaseVelocity') }),
		channel: integer(input.channel ?? 0, 0, 15, 'MIDI note.channel'),
	};
}

export function normalizeMidiNotes(value: unknown): readonly MidiNote[] {
	const input = boundedArray(value, MIDI_MAXIMUM_NOTES, 'MIDI notes');
	const notes = input.map(normalizeMidiNote);
	if (new Set(notes.map(note => note.id)).size !== notes.length) throw new RangeError('MIDI notes contain duplicate IDs.');
	return notes;
}

export function normalizeMidiClipData(value: unknown): MidiClipData {
	const input = versionedData(value, 'MIDI clip');
	return {
		version: 1,
		notes: normalizeMidiNotes(input.notes),
		...(input.interchange === undefined ? {} : { interchange: normalizeInterchange(input.interchange) }),
	};
}

export function normalizeMidiTrackData(value: unknown): MidiTrackData {
	const input = versionedData(value, 'MIDI track');
	if (!MIDI_INSTRUMENTS.includes(input.instrument as MidiInstrument)) throw new RangeError('MIDI track.instrument is unsupported.');
	return {
		version: 1,
		instrument: input.instrument as MidiInstrument,
		...(input.program === undefined ? {} : { program: integer(input.program, 0, 127, 'MIDI track.program') }),
	};
}

export function addMidiNoteData(data: MidiClipData, note: MidiNote): MidiClipData {
	return normalizeMidiClipData({ ...data, notes: [...data.notes, note] });
}

export function updateMidiNoteData(
	data: MidiClipData,
	noteId: string,
	updates: Partial<Omit<MidiNote, 'id'>>,
): MidiClipData {
	if (!data.notes.some(note => note.id === noteId)) throw new ReferenceError(`MIDI note ${noteId} is missing.`);
	return normalizeMidiClipData({
		...data,
		notes: data.notes.map(note => note.id === noteId ? { ...note, ...updates, id: note.id } : note),
	});
}

/** Validate one gesture without cloning the whole clip for every selected note. */
export function updateMidiNotesData(
	data: MidiClipData,
	updates: readonly Readonly<{ id: string; changes: Partial<MidiNote> }>[],
): MidiClipData {
	if (!updates.length) return data;
	if (updates.length === 1) return updateMidiNoteData(data, updates[0]!.id, updates[0]!.changes);
	const notes = new Map(data.notes.map(note => [note.id, note]));
	for (const { id, changes } of updates) {
		const previous = notes.get(id);
		if (!previous) throw new ReferenceError(`MIDI note ${id} is missing.`);
		// Validate each step, including repeated edits to one note, before publishing the batch.
		notes.set(id, normalizeMidiNote({ ...previous, ...changes, id }));
	}
	return normalizeMidiClipData({ ...data, notes: data.notes.map(note => notes.get(note.id)!) });
}

export function removeMidiNoteData(data: MidiClipData, noteIds: readonly string[]): MidiClipData {
	const removed = new Set(noteIds);
	return normalizeMidiClipData({ ...data, notes: data.notes.filter(note => !removed.has(note.id)) });
}

/** Persisted admission checks carriers even if the beta editor is never opened. */
export function validateProjectMidiCarriers(project: Readonly<{
	tracks: readonly unknown[];
	clips: readonly unknown[];
	binClips?: readonly unknown[];
	sources?: readonly Readonly<Record<string, unknown>>[];
}>): void {
	for (const track of project.tracks) readMidiTrack(track);
	for (const clip of [...project.clips, ...project.binClips ?? []]) {
		const midi = readMidiClip(clip);
		if (!midi || !project.sources) continue;
		const source = project.sources.find(source => source.id === record(clip, 'MIDI clip').sourceId);
		if (!source || source.kind !== 'audio' || midi.notes.some(note => note.startFrame + note.durationFrames > Number(source.frameCount))) {
			throw new RangeError('MIDI notes require a complete audio fallback source.');
		}
	}
}

function carrierData(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return ABSENT_MIDI_DATA;
	const extensions = (value as Carrier).opaqueExtensions;
	if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return ABSENT_MIDI_DATA;
	return Object.hasOwn(extensions, MIDI_EXTENSION_KEY)
		? (extensions as Carrier)[MIDI_EXTENSION_KEY]
		: ABSENT_MIDI_DATA;
}

function withCarrierData<Value extends Carrier>(value: Value, data: MidiClipData | MidiTrackData): Value {
	const extensions = value.opaqueExtensions === undefined ? {} : record(value.opaqueExtensions, 'opaqueExtensions');
	return { ...value, opaqueExtensions: { ...extensions, [MIDI_EXTENSION_KEY]: data } };
}

function normalizeInterchange(value: unknown): MidiClipInterchange {
	const input = record(value, 'MIDI interchange');
	const events = boundedArray(input.events, 1_000_000, 'MIDI interchange.events').map(value => {
		const event = record(value, 'MIDI event');
		const status = integer(event.status, 0x80, 0xff, 'MIDI event.status');
		const conductor = event.conductor;
		if (conductor !== undefined && (typeof conductor !== 'boolean' || status !== 255 || event.metaType !== 0x54)) {
			throw new RangeError('Invalid MIDI event.conductor provenance.');
		}
		const data = boundedArray(event.data, 1_048_576, 'MIDI event.data').map(byte => integer(byte, 0, status < 0xf0 ? 127 : 255, 'MIDI event byte'));
		if (status < 0xf0) {
			const type = status & 0xf0;
			if (type === 0x80 || type === 0x90 || data.length !== (type === 0xc0 || type === 0xd0 ? 1 : 2)) {
				throw new RangeError('Invalid auxiliary MIDI channel event.');
			}
		} else if (status === 0xff) integer(event.metaType, 0, 127, 'MIDI event.metaType');
		else if (status !== 0xf0 && status !== 0xf7) throw new RangeError('Unsupported MIDI system event.');
		return {
			frame: integer(event.frame, 0, Number.MAX_SAFE_INTEGER, 'MIDI event.frame'),
			status,
			data,
			...(event.metaType === undefined ? {} : { metaType: integer(event.metaType, 0, 127, 'MIDI event.metaType') }),
			...(conductor === undefined ? {} : { conductor }),
		};
	});
	const tempos = boundedArray(input.tempos, 100_000, 'MIDI interchange.tempos').map(value => {
		const tempo = record(value, 'MIDI tempo');
		const bpm = Number(tempo.bpm);
		if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 60_000_000) throw new RangeError('MIDI tempo.bpm must be positive.');
		return { frame: integer(tempo.frame, 0, Number.MAX_SAFE_INTEGER, 'MIDI tempo.frame'), bpm };
	});
	const signatures = boundedArray(input.signatures, 100_000, 'MIDI interchange.signatures').map(value => {
		const signature = record(value, 'MIDI signature');
		const denominator = integer(signature.denominator, 1, 2 ** 30, 'MIDI signature.denominator');
		if ((denominator & (denominator - 1)) !== 0) throw new RangeError('MIDI signature.denominator must be a power of two.');
		return {
			frame: integer(signature.frame, 0, Number.MAX_SAFE_INTEGER, 'MIDI signature.frame'),
			numerator: integer(signature.numerator, 1, 255, 'MIDI signature.numerator'),
			denominator,
			...(signature.clocksPerMetronomeClick === undefined ? {} : {
				clocksPerMetronomeClick: integer(signature.clocksPerMetronomeClick, 0, 255, 'MIDI signature.clocksPerMetronomeClick'),
			}),
			...(signature.notated32ndNotesPerQuarter === undefined ? {} : {
				notated32ndNotesPerQuarter: integer(signature.notated32ndNotesPerQuarter, 0, 255, 'MIDI signature.notated32ndNotesPerQuarter'),
			}),
		};
	});
	return { events, tempos, signatures };
}

function versionedData(value: unknown, name: string): Carrier {
	const data = record(value, name);
	if (data.version !== 1) throw new RangeError(`${name} has an unsupported version.`);
	return data;
}

function record(value: unknown, name: string): Carrier {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Carrier;
}

function integer(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer from ${String(minimum)} to ${String(maximum)}.`);
	}
	return Number(value);
}

function boundedArray(value: unknown, maximum: number, name: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum) throw new RangeError(`${name} must be an array with at most ${String(maximum)} entries.`);
	return value;
}
