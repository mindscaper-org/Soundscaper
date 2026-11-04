/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const MIDI_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		track: 'MIDI track (beta)',
		pianoRoll: 'Piano roll (beta)',
		exportMidi: 'Export MIDI (beta)',
		exportAllegro: 'Export Allegro (beta)',
		empty: 'Select a MIDI track or clip to edit.',
		clip: 'MIDI clip',
		instrument: 'Instrument',
		sine: 'Sine', triangle: 'Triangle', square: 'Square', sawtooth: 'Sawtooth',
		snap: 'Note grid',
		triplets: 'Triplets',
		velocity: 'Velocity',
		keyboard: 'Computer keyboard',
		octave: 'Keyboard octave',
		keyboardHint: 'A–K play notes; Z/X change octave.',
		addNote: 'Add note',
		deleteNotes: 'Delete selected notes',
		selectedNote: 'Selected note',
		noSelection: 'No selected note',
		noteOption: '{pitch} · {time}s',
		pitch: 'Pitch (MIDI number)',
		start: 'Note start (seconds)',
		duration: 'Note duration (seconds)',
		channel: 'MIDI channel',
		preview: 'Preview selected note',
		noteEditor: 'Note editor',
		grid: 'Piano roll notes',
	}),
});

export function resolveMidiCopy(copy: Readonly<Record<string, unknown>> = {}) {
	return resolveEditorCopyScope('midi', MIDI_COPY_BY_LOCALE.en, copy);
}
