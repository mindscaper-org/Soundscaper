/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { createMidiActionGroup } from '../src/common/editor/controller/composition/midi-action-group.ts';
import type { EditorActionRuntime } from '../src/common/editor/controller/composition/action-facade-runtime.ts';

test('a first-use MIDI export cannot select a different project while the service loads', async () => {
	const origin = midiServiceFixture({ id: 'origin', title: 'Origin MIDI' });
	const destination = midiServiceFixture({ id: 'destination', title: 'Destination MIDI' });
	const { clipId } = await destination.service.addTrack();
	await destination.service.addNote(clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 });
	let project = origin.project();
	const group = createMidiActionGroup({
		getProject: () => project, state: {}, publishDocumentSnapshot() {},
		fileService: { saveFile: destination.dependencies.saveFile },
	} as unknown as EditorActionRuntime);
	const pending = group.actions.exportFile('midi');
	project = destination.project();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(destination.saves, []);
});

test('a MIDI export retired during codec load does not open its save destination', async () => {
	const origin = midiServiceFixture({ id: 'origin', title: 'Origin MIDI' });
	const { clipId } = await origin.service.addTrack();
	await origin.service.addNote(clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 });
	let project = origin.project();
	const service = createMidiService({ ...origin.dependencies, getProject: () => project });
	const pending = service.exportFile('midi');
	await Promise.resolve();
	project = midiServiceFixture({ id: 'destination', title: 'Destination MIDI' }).project();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(origin.saves, []);
});

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
