/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const note = { id: 'n', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 90, channel: 0 };

test('dropping a MIDI file into Project Bin imports media without changing the timeline or tempo', async () => {
	const f = midiServiceFixture();
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 90 }], signatures: [], tracks: [{ name: 'Melody', notes: [note] }] });
	const importFiles = createMidiImportFiles({ getProject: f.project, importFiles: () => { throw new Error('Unexpected audio decoder route'); } }, async () => f.service);
	await importFiles([new File([bytes], 'Melody.mid')], { destination: 'project-bin' });
	assert.equal(f.project().clips.length, 0);
	assert.equal(f.project().tracks.length, 0);
	assert.equal(f.project().projectBin.clips.length, 1);
	assert.equal(readMidiClip(f.project().projectBin.clips[0])?.notes[0]?.pitch, 60);
	assert.equal(f.project().tempo.bpm, 120);
});

test('moving MIDI through Project Bin preserves the original instrument after reopening and placement', () => {
	const f = midiServiceFixture({ sources: [createAudioSource({ id: 'source', sampleRate: 8000, frameCount: 16000, channelCount: 1 })],
		tracks: [{ ...createMidiTrack({ id: 'origin', instrument: 'square', program: 81, clipIds: ['clip'] }, 8000) },
			{ ...createAudioTrack({ id: 'target' }, 8000) }],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'source', durationFrames: 16000, notes: [note] }) }] });
	f.apply({ type: 'project-bin/move-from-timeline', clipIds: ['clip'] });
	const reopened = midiServiceFixture(structuredClone(f.project()));
	reopened.apply({ type: 'project-bin/place', binClipId: 'clip', clipId: 'placed', trackId: 'target', timelineStartFrame: 0 });
	assert.deepEqual(readMidiTrack(reopened.project().tracks.find(track => track.id === 'target')), { version: 1, instrument: 'square', program: 81 });
	assert.equal(readMidiClip(reopened.project().clips[0])?.notes[0]?.pitch, 60);
});
