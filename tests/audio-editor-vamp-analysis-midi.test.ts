/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { vampMidiOutputKind, midiDocumentFromVampNotes } from '../src/common/editor/vamp-analysis-midi.ts';
import type { VampAnalysisResult, VampOutputDescriptor } from '../src/common/editor/vamp-analysis.ts';

const output = (id = 'notes', unit = 'Hz'): VampOutputDescriptor => ({
	id, unit, name: 'Notes', description: '', hasDuration: true,
	sampleType: 'variable-sample-rate', sampleRate: null,
});
function result(values: readonly number[] = [440]): VampAnalysisResult {
	return { schemaVersion: 1, request: {
		schemaVersion: 1, analyzerId: 'installed', stableId: 'pyin', binarySha256: 'ab'.repeat(32),
		outputId: 'notes', program: null, parameters: [], scope: 'track',
		startFrame: 48_000, endFrame: 144_000, sampleRate: 48_000,
	}, features: [{ timestamp: { seconds: 0, nanoseconds: 250_000_000 },
		duration: { seconds: 0, nanoseconds: 500_000_000 }, values, label: '' }] };
}

test('pYIN note frequencies become editable MIDI with selection-relative timing and trailing silence', () => {
	const document = midiDocumentFromVampNotes(result(), output(), 'Sung melody');
	assert.equal(document.sampleRate, 48_000);
	assert.deepEqual(document.tracks[0], { name: 'Sung melody', durationFrames: 96_000, notes: [{
		id: 'vamp-note-0', pitch: 69, startFrame: 12_000, durationFrames: 24_000, velocity: 100, channel: 0,
	}] });
	assert.deepEqual(document.tempos, []);
	assert.deepEqual(document.signatures, []);
});

test('Chordino preserves simultaneous chord tones without quantization or monophonic flattening', () => {
	const value = result();
	const chord = { ...value, request: { ...value.request, outputId: 'chordnotes' },
		features: [60, 64, 67].map(pitch => ({ ...value.features[0]!, values: [pitch] })) };
	const document = midiDocumentFromVampNotes(chord, output('chordnotes', 'MIDI units'), 'Chords');
	assert.deepEqual(document.tracks[0]!.notes.map(({ pitch, startFrame, durationFrames }) => ({ pitch, startFrame, durationFrames })),
		[60, 64, 67].map(pitch => ({ pitch, startFrame: 12_000, durationFrames: 24_000 })));
});

test('only duration-bearing note outputs have MIDI meaning', () => {
	assert.equal(vampMidiOutputKind(output()), 'frequency');
	assert.equal(vampMidiOutputKind(output('chordnotes', 'MIDI units')), 'midi');
	assert.equal(vampMidiOutputKind({ ...output(), hasDuration: false }), null);
	assert.equal(vampMidiOutputKind(output('smoothedpitchtrack', 'Hz')), null);
	assert.equal(vampMidiOutputKind(output('notes', 'dB')), null);
	assert.throws(() => midiDocumentFromVampNotes(result(), output('onsets', ''), 'Wrong output'), /note output/iu);
});

test('malformed, empty and out-of-range note results never create MIDI', () => {
	for (const values of [[0], [-440], [1], [100_000], [440, 880], []]) {
		assert.throws(() => midiDocumentFromVampNotes(result(values), output(), 'Bad notes'));
	}
	const value = result();
	for (const duration of [null, { seconds: 0, nanoseconds: 0 }]) {
		assert.throws(() => midiDocumentFromVampNotes({ ...value, features: [{ ...value.features[0]!, duration }] }, output(), 'Bad duration'));
	}
	assert.throws(() => midiDocumentFromVampNotes({ ...value, features: [] }, output(), 'Empty'), /no notes/iu);
	assert.throws(() => midiDocumentFromVampNotes(value, output(), '  '), /name/iu);
});

test('fractional Vamp times use the enclosing sample frames', () => {
	const value = result();
	const document = midiDocumentFromVampNotes({ ...value, features: [{ ...value.features[0]!,
		timestamp: { seconds: 0, nanoseconds: 10_000 }, duration: { seconds: 0, nanoseconds: 20_000 },
	}] }, output(), 'Short');
	assert.equal(document.tracks[0]!.notes[0]!.startFrame, 0);
	assert.equal(document.tracks[0]!.notes[0]!.durationFrames, 2);
});
