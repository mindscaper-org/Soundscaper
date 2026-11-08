/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';

test('MIDI export includes the note edit already requested while its PCM is publishing', async () => {
	const f = midiServiceFixture();
	const { clipId } = await f.service.addTrack();
	await f.service.addNote(clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 });
	const update = f.service.updateNote(clipId, 'note', { pitch: 67 });
	const exporting = f.service.exportFile('midi');
	await Promise.all([update, exporting]);
	const document = parseMidiFile(f.saves[0]!.bytes as Uint8Array, { sampleRate: 8000 });
	assert.equal(document.tracks.flatMap(track => track.notes)[0]?.pitch, 67);
});
