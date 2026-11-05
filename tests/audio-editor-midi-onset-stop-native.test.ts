/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function midi(stopAfter: boolean, controller = 120): Uint8Array {
	const on = [0, 0x90, 69, 100], stop = [0, 0xb0, controller, 0];
	const body = [0, 0xb0, 64, 127, ...(stopAfter ? [...on, ...stop] : [...stop, ...on]),
		0x83, 0x60, 0xb0, 64, 0, 0, 0xff, 0x2f, 0];
	return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
		0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]);
}

for (const stopAfter of [false, true]) test(`same-tick panic ${stopAfter ? 'after' : 'before'} NoteOn survives native save and instrument regeneration`, async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(midi(stopAfter), { sampleRate: 8000 }));
	const clip = f.project().clips[0], track = f.project().tracks[0]; assert.ok(clip && track);
	const note = readMidiClip(clip)?.notes[0]; assert.ok(note);
	assert.equal(note.onsetStop !== undefined, stopAfter);
	assert.equal(f.pcm.get(clip.sourceId)?.[0]?.some(value => value !== 0), !stopAfter);
	await f.service.updateNote(clip.id, note.id, { pitch: 72, velocity: 90 });
	const restored: unknown = JSON.parse(JSON.stringify(f.project()));
	assert.ok(validateAudioEditorProjectV17(restored));
	let project = restored;
	assert.equal(readMidiClip(project.clips[0])?.notes[0]?.pitch, 72);
	let sequence = 0;
	const reopened = createMidiService({ ...f.dependencies, getProject: () => project,
		createId: prefix => `native-${prefix}-${++sequence}`,
		commit: command => { project = applyEditorCommand(project, command); } });
	await reopened.setInstrument(track.id, 'square');
	const savedClip = project.clips[0]; assert.ok(savedClip);
	assert.equal(f.pcm.get(savedClip.sourceId)?.[0]?.some(value => value !== 0), !stopAfter);
	await reopened.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const second = midiServiceFixture();
	await second.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	const secondClip = second.project().clips.find(candidate => readMidiClip(candidate)?.notes.length); assert.ok(secondClip);
	assert.equal(second.pcm.get(secondClip.sourceId)?.[0]?.some(value => value !== 0), !stopAfter);
	assert.equal(readMidiClip(secondClip)?.notes[0]?.velocity, 90);
});

test('same-tick All Notes Off remains pedal-held and is not treated as immediate All Sound Off', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(midi(true, 123), { sampleRate: 8000 }));
	const clip = f.project().clips[0]; assert.ok(clip);
	assert.equal(readMidiClip(clip)?.notes[0]?.onsetStop?.kind, 'all-notes-off');
	assert.ok(f.pcm.get(clip.sourceId)?.[0]?.slice(100, 1000).some(value => value !== 0));
});
