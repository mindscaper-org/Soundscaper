/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNote } from './midi-model.ts';

/** Auxiliary MIDI messages retain controller/program/meta state through file interchange. */
export interface MidiFileEvent {
	readonly frame: number;
	readonly status: number;
	readonly data: readonly number[];
	readonly metaType?: number;
}

export interface MidiFileTrack {
	readonly name: string;
	readonly notes: readonly MidiNote[];
	/** End-of-Track position, including authored trailing silence. */
	readonly durationFrames?: number;
	readonly events?: readonly MidiFileEvent[];
	readonly program?: number;
}

export interface MidiFileTempo {
	readonly frame: number;
	readonly bpm: number;
}

export interface MidiFileSignature {
	readonly frame: number;
	readonly numerator: number;
	readonly denominator: number;
}

export interface MidiFileDocument {
	readonly sampleRate: number;
	readonly tracks: readonly MidiFileTrack[];
	readonly tempos: readonly MidiFileTempo[];
	readonly signatures: readonly MidiFileSignature[];
}

export interface MidiFileReadOptions {
	readonly sampleRate?: number;
}

export const MIDI_FILE_MAX_BYTES = 16 * 1024 * 1024;
export const MIDI_FILE_MAX_EVENTS = 250_000;
export const MIDI_FILE_MAX_TRACKS = 256;

export function midiFileInteger(value: number, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid MIDI ${name}.`);
	return value;
}

export function midiFileSampleRate(value = 48_000): number {
	return midiFileInteger(value, 1, 768_000, 'sample rate');
}

export function validateMidiFileDocument(document: MidiFileDocument): void {
	midiFileSampleRate(document.sampleRate);
	midiFileInteger(document.tracks.length, 1, MIDI_FILE_MAX_TRACKS, 'track count');
	let count = document.tempos.length + document.signatures.length;
	for (const track of document.tracks) {
		if (typeof track.name !== 'string' || track.name.length > 65_536) throw new RangeError('Invalid MIDI track name.');
		if (track.durationFrames !== undefined) midiFileInteger(track.durationFrames, 0, Number.MAX_SAFE_INTEGER, 'track duration');
		count += track.notes.length + (track.events?.length ?? 0);
		if (track.program !== undefined) midiFileInteger(track.program, 0, 127, 'program');
		for (const note of track.notes) {
			midiFileInteger(note.pitch, 0, 127, 'pitch');
			midiFileInteger(note.velocity, 0, 127, 'velocity');
			if (note.releaseVelocity !== undefined) midiFileInteger(note.releaseVelocity, 0, 127, 'release velocity');
			midiFileInteger(note.channel, 0, 15, 'channel');
			midiFileInteger(note.startFrame, 0, Number.MAX_SAFE_INTEGER, 'note start');
			midiFileInteger(note.durationFrames, 1, Number.MAX_SAFE_INTEGER - note.startFrame, 'note duration');
		}
		for (const event of track.events ?? []) {
			midiFileInteger(event.frame, 0, Number.MAX_SAFE_INTEGER, 'event time');
			midiFileInteger(event.status, 128, 255, 'event status');
			for (const byte of event.data) midiFileInteger(byte, 0, event.status < 240 ? 127 : 255, 'event byte');
			if (event.status < 240) {
				const type = event.status & 240;
				if (type === 128 || type === 144 || event.data.length !== (type === 192 || type === 208 ? 1 : 2)) {
					throw new RangeError('Invalid auxiliary MIDI channel message.');
				}
			} else if (event.status === 255) midiFileInteger(event.metaType ?? -1, 0, 127, 'meta event type');
			else if (event.status !== 240 && event.status !== 247) throw new RangeError('Unsupported MIDI system message.');
		}
	}
	if (count > MIDI_FILE_MAX_EVENTS) throw new RangeError('MIDI file contains too many events.');
	for (const tempo of document.tempos) {
		midiFileInteger(tempo.frame, 0, Number.MAX_SAFE_INTEGER, 'tempo time');
		if (!Number.isFinite(tempo.bpm) || tempo.bpm <= 0 || tempo.bpm > 60_000_000) throw new RangeError('Invalid MIDI tempo.');
	}
	for (const signature of document.signatures) {
		midiFileInteger(signature.frame, 0, Number.MAX_SAFE_INTEGER, 'signature time');
		midiFileInteger(signature.numerator, 1, 255, 'signature numerator');
		const exponent = Math.log2(signature.denominator);
		midiFileInteger(exponent, 0, 30, 'signature denominator');
	}
}
