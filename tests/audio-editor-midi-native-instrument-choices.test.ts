/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withMidiTrackData } from '../src/common/editor/midi-model.ts';
import { midiNativeInstrumentChoices, hasSelectedMidiInstrumentTrack } from '../src/common/editor/ui/workspace/midi-native-instrument-choices.ts';

const track = withMidiTrackData({ id: 'midi', type: 'audio' }, { version: 1, instrument: 'triangle' });
const installation = { installationId: 'synth', version: '1', allowed: true, selected: true, quarantined: false };
const instrument = { entryId: 'surge', classification: 'instrument', format: 'vst3', name: 'Surge XT', vendor: 'Surge Synth Team', eligible: true,
	ineligibleReason: null, installations: [installation] };

test('MIDI instrument selection includes synths and excludes every effect and audio-track target', () => {
	const registry = { entries: [instrument, { ...instrument, entryId: 'dexed', name: 'Dexed' },
		{ ...instrument, entryId: 'effect', classification: 'effect', name: 'Reverb' }] };
	assert.deepEqual(midiNativeInstrumentChoices(registry, track).map(choice => choice.label), ['Surge XT', 'Dexed']);
	assert.deepEqual(midiNativeInstrumentChoices(registry, { type: 'audio' }), []);
	assert.equal(hasSelectedMidiInstrumentTrack({ project: { tracks: [track] }, getSnapshot: () => ({ selectedTrackId: 'midi' }) }), true);
	assert.equal(hasSelectedMidiInstrumentTrack({ project: { tracks: [track] }, getSnapshot: () => ({ selectedTrackId: 'other' }) }), false);
});

test('disabled, quarantined and incompatible synth installations are absent', () => {
	for (const change of [{ allowed: false }, { quarantined: true }]) {
		assert.deepEqual(midiNativeInstrumentChoices({ entries: [{ ...instrument, installations: [{ ...installation, ...change }] }] }, track), []);
	}
	assert.deepEqual(midiNativeInstrumentChoices({ entries: [{ ...instrument, eligible: false, ineligibleReason: 'incompatible' }] }, track), []);
});
