/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('trimming imported MIDI retains its device and port destination before the retained notes', async () => {
	const imported = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'External keys',
		durationFrames: 24_000, notes: [{ id: 'key', pitch: 60, channel: 0, velocity: 100, startFrame: 8000, durationFrames: 8000 }],
		events: [{ frame: 0, status: 0xff, metaType: 9, data: [...new TextEncoder().encode('Stage piano')] },
			{ frame: 0, status: 0xff, metaType: 0x21, data: [2] }] }] }), { sampleRate: 8000 });
	const f = midiServiceFixture();
	const created = await f.service.importDocument(imported);
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 4000, durationFrames: 16_000 });
	const output = parseMidiFile(writeMidiFile(midiDocumentFromProject({ ...f.project() })), { sampleRate: 8000 });
	const events = output.tracks.find(track => track.notes.length)!.events ?? [];
	assert.deepEqual(events.filter(event => event.metaType === 9 || event.metaType === 0x21), [
		{ frame: 0, status: 0xff, metaType: 9, data: [...new TextEncoder().encode('Stage piano')] },
		{ frame: 0, status: 0xff, metaType: 0x21, data: [2] },
	]);
});
