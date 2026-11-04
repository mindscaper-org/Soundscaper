/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioClip, createAudioTrack } from './project-media-factory.ts';
import type { AudioClipLeaf, AudioTrackLeaf, MediaFactoryInput } from './project-media-types.ts';
import {
	withMidiClipData,
	withMidiTrackData,
	type MidiClipInterchange,
	type MidiInstrument,
	type MidiNote,
} from './midi-model.ts';

export interface MidiTrackOptions extends MediaFactoryInput {
	readonly instrument?: MidiInstrument;
	readonly program?: number;
}

export interface MidiClipOptions extends MediaFactoryInput {
	readonly sourceId: string;
	readonly durationFrames: number;
	readonly notes?: readonly MidiNote[];
	readonly interchange?: MidiClipInterchange;
}

/** MIDI tracks share the existing mixer, history and PCM fallback contracts. */
export function createMidiTrack(options: MidiTrackOptions = {}, projectSampleRate = 48_000): AudioTrackLeaf {
	const { instrument = 'triangle', program, ...audioOptions } = options;
	return withMidiTrackData(createAudioTrack(audioOptions, projectSampleRate), {
		version: 1,
		instrument,
		...(program === undefined ? {} : { program }),
	});
}

/** The caller must store the rendered fallback source before publishing the clip. */
export function createMidiClip(options: MidiClipOptions): AudioClipLeaf {
	const { notes = [], interchange, ...audioOptions } = options;
	return withMidiClipData(createAudioClip(audioOptions), {
		version: 1,
		notes,
		...(interchange === undefined ? {} : { interchange }),
	});
}
