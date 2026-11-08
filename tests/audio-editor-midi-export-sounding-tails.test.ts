/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('MIDI export retains the audible sustained tail after trimming away the released key', async () => {
	const imported = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Pedal',
		durationFrames: 24_000, notes: [{ id: 'key', pitch: 60, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000 }],
		events: [{ frame: 0, status: 0xb0, data: [64, 127] }, { frame: 16_000, status: 0xb0, data: [64, 0] }] }] }), { sampleRate: 8000 });
	const f = midiServiceFixture();
	const created = await f.service.importDocument(imported);
	const { clipId } = created[0]!;
	assert.ok(clipId);
	await f.service.resizeClip(clipId, { timelineStartFrame: 0, sourceStartFrame: 8000, durationFrames: 12_000 });
	assert.equal(f.project().clips[0]?.sourceStartFrame, 8000);
	const source = imported.tracks.find(track => track.notes.length)!;
	assert.ok(energy(renderMidiFrames(source.notes, 'sine', 8000, 8000, 4000, source.events)) > 1);
	const output = parseMidiFile(writeMidiFile(midiDocumentFromProject({ ...f.project() })), { sampleRate: 8000 });
	const retained = output.tracks.find(track => track.notes.length);
	assert.ok(retained, 'the trimmed clip still contains a sounding pedal-held note');
	assert.ok(energy(renderMidiFrames(retained.notes, 'sine', 8000, 1000, 4000, retained.events)) > 1);
	assert.equal(energy(renderMidiFrames(retained.notes, 'sine', 8000, 9000, 2000, retained.events)), 0);
});

function energy(samples: Float32Array): number {
	return samples.reduce((total, value) => total + value * value, 0);
}
