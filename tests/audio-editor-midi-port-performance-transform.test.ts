/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

async function transformed(kind: 'reversed' | 'looped', performance: boolean) {
	const f = midiServiceFixture();
	const imported = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'Port 1',
		durationFrames: 16_000, notes: [{ id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 2000, durationFrames: 12_000, midiPort: 1 }],
		events: [{ frame: 0, status: 255, metaType: 0x21, data: [1] },
			...(performance ? [{ frame: 12_000, status: 0xb0, data: [7, 0] }] : []),
			{ frame: 14_000, status: 255, metaType: 0x21, data: [0] }],
	}] }), { sampleRate: 8000 });
	const created = await f.service.importDocument(imported);
	f.apply({ type: 'clip/update', clipId: created[0]!.clipId, changes: kind === 'reversed'
		? { reversed: true } : { loop: { periodFrames: 16_000, durationFrames: 32_000 } } });
	assert.ok(validateAudioEditorProjectV17(f.project()));
	return f;
}

for (const kind of ['reversed', 'looped'] as const) {
	test(`MIDI delivery refuses ${kind} port-aware performance state before saving altered channel levels`, async () => {
		const f = await transformed(kind, true);
		await assert.rejects(f.service.exportFile('midi'), /port.*performance|performance.*port/iu);
		assert.equal(f.saves.length, 0);
		assert.ok(validateAudioEditorProjectV17(f.project()), 'native save remains available for the authored edit');
	});
	test(`ordinary port-aware notes still support ${kind} MIDI delivery`, async () => {
		const f = await transformed(kind, false);
		await f.service.exportFile('midi');
		const bytes = f.saves[0]?.bytes;
		assert.ok(bytes instanceof Uint8Array);
		const notes = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes);
		assert.equal(notes.length, kind === 'reversed' ? 1 : 2);
		assert.ok(notes.every(note => note.midiPort === 1));
	});
}
