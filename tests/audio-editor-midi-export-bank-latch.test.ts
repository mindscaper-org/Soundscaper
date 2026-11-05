/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile, writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('trimmed MIDI and Allegro keep the active program bank separately from a pending bank selection', async () => {
	const imported = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Banked instrument',
		durationFrames: 24_000, notes: [{ id: 'key', pitch: 60, channel: 0, velocity: 100, startFrame: 6000, durationFrames: 12_000 }],
		events: [{ frame: 0, status: 0xb0, data: [0, 1] }, { frame: 0, status: 0xb0, data: [32, 2] },
			{ frame: 1000, status: 0xc0, data: [5] }, { frame: 2000, status: 0xb0, data: [0, 3] },
			{ frame: 2000, status: 0xb0, data: [32, 4] }, { frame: 12_000, status: 0xc0, data: [6] }] }] }), { sampleRate: 8000 });
	const f = midiServiceFixture();
	const created = await f.service.importDocument(imported);
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 4000, durationFrames: 16_000 });
	const exported = midiDocumentFromProject({ ...f.project() });
	for (const output of [parseMidiFile(writeMidiFile(exported), { sampleRate: 8000 }), parseAllegroFile(writeAllegroFile(exported), { sampleRate: 8000 })]) {
		const events = output.tracks.find(track => track.notes.length)!.events ?? [];
		assert.deepEqual(programAt(events, 0), [1, 2, 5], 'the sounding patch retains the bank latched by its earlier program change');
		assert.deepEqual(programAt(events, 8000), [3, 4, 6], 'the later program change consumes the separately retained pending bank');
	}
});

function programAt(events: readonly MidiFileEvent[], frame: number): readonly number[] {
	let msb = 0, lsb = 0;
	let program = [0, 0, 0];
	for (const event of events) if (event.frame <= frame) {
		if (event.status === 0xb0 && event.data[0] === 0) msb = event.data[1]!;
		if (event.status === 0xb0 && event.data[0] === 32) lsb = event.data[1]!;
		if (event.status === 0xc0) program = [msb, lsb, event.data[0]!];
	}
	return program;
}
