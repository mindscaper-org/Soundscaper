/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { routeMidiImportControls } from '../src/common/editor/controller/track-audio/internal/midi-import-channel-routing.ts';
import type { MidiFileTrack } from '../src/common/editor/midi-file-types.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';

function track(bytes: readonly number[]): number[] {
	return [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, bytes.length, ...bytes];
}
function midi(controls: readonly number[], notes: readonly number[]): Uint8Array {
	return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0,
		...track([...controls, 0, 0xb0, 7, 0, 0x83, 0x60, 0xff, 0x2f, 0]),
		...track([...notes, 0, 0x90, 69, 100, 0x83, 0x60, 0x80, 69, 0, 0, 0xff, 0x2f, 0])]);
}

for (const [name, controls, notes, audible] of [
	['default port', [], [], false],
	['other port', [0, 0xff, 0x21, 1, 0], [0, 0xff, 0x21, 1, 1], true],
	['same nondefault port', [0, 0xff, 0x21, 1, 1], [0, 0xff, 0x21, 1, 1], false],
	['other device', [0, 0xff, 9, 1, 65], [0, 0xff, 9, 1, 66], true],
	['same device', [0, 0xff, 9, 1, 65], [0, 0xff, 9, 1, 65], false],
	['explicit empty versus absent device', [0, 0xff, 9, 0], [], true],
] as const) test(`MIDI import keeps channel expression on its ${name} destination`, async () => {
	const document = parseMidiFile(midi(controls, notes), { sampleRate: 8000 });
	const original = structuredClone(document);
	const f = midiServiceFixture();
	await f.service.importDocument(document);
	const clip = f.project().clips.find(clip => readMidiClip(clip)?.notes.length);
	assert.ok(clip);
	const samples = f.pcm.get(clip.sourceId)?.[0]; assert.ok(samples);
	assert.equal(samples.some(value => value !== 0), audible);
	assert.deepEqual(document, original);
	const note = readMidiClip(clip)?.notes[0]; assert.ok(note);
	await f.service.updateNote(clip.id, note.id, { pitch: 67 });
	let reopened = createAudioEditorProjectV17(structuredClone(f.project()));
	const owner = reopened.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)); assert.ok(owner);
	let sequence = 0;
	const service = createMidiService({ ...f.dependencies, getProject: () => reopened,
		createId: prefix => `reopened-${prefix}-${++sequence}`,
		commit: command => { reopened = applyEditorCommand(reopened, command); } });
	await service.setInstrument(owner.id, 'square');
	const editedClip = reopened.clips.find(candidate => candidate.id === clip.id); assert.ok(editedClip);
	assert.equal(f.pcm.get(editedClip.sourceId)?.[0]?.some(value => value !== 0), audible);
	await service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const exported = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(exported.tracks.flatMap(track => track.events ?? []).filter(event => event.status === 0xb0 && event.data[0] === 7).length, 1);
	if (!audible) {
		const owner = exported.tracks.find(track => track.notes.length); assert.ok(owner);
		const selectors = owner.events?.filter(event => event.status === 255 && [9, 0x21].includes(event.metaType ?? -1)) ?? [];
		assert.deepEqual(selectors.map(event => [event.metaType, event.data]), document.tracks[1]?.events?.filter(event => event.status === 255).map(event => [event.metaType, event.data]) ?? []);
		const volumeIndex = owner.events?.findIndex(event => event.status === 0xb0) ?? -1;
		assert.ok(selectors.every(selector => (owner.events?.indexOf(selector) ?? -1) < volumeIndex));
	}
});

test('MIDI routing retains multi-destination owner controls instead of applying them to every same-channel note', () => {
	const note = { id: 'n', channel: 0, pitch: 69, velocity: 100, startFrame: 0, durationFrames: 100 };
	const tracks: readonly MidiFileTrack[] = [
		{ name: 'Control', notes: [], events: [{ frame: 0, status: 0xb0, data: [7, 0] }] },
		{ name: 'Two ports', notes: [note], noteDestinations: [{ channel: 0, port: 0 }, { channel: 0, port: 1 }] },
	];
	assert.deepEqual(routeMidiImportControls(tracks), tracks);
	assert.deepEqual(routeMidiImportControls([...tracks,
		{ name: 'Also port zero', notes: [{ ...note, id: 'second' }], noteDestinations: [{ channel: 0, port: 0 }] },
	]), [...tracks, { name: 'Also port zero', notes: [{ ...note, id: 'second' }], noteDestinations: [{ channel: 0, port: 0 }] }]);
});

test('MIDI routing uses actual raw NoteOn destination when a selector follows at the same tick', async () => {
	const document = parseMidiFile(Uint8Array.from([
		0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0,
		...track([0, 0xff, 0x21, 1, 1, 0, 0xb0, 7, 0, 0x83, 0x60, 0xff, 0x2f, 0]),
		...track([0, 0x90, 69, 100, 0, 0xff, 0x21, 1, 1, 0x83, 0x60, 0x80, 69, 0, 0, 0xff, 0x2f, 0]),
	]), { sampleRate: 8000 });
	assert.deepEqual(document.tracks[1]?.noteDestinations, [{ channel: 0, port: 0 }]);
	const f = midiServiceFixture(); await f.service.importDocument(document);
	const clip = f.project().clips.find(clip => readMidiClip(clip)?.notes.length); assert.ok(clip);
	assert.ok(f.pcm.get(clip.sourceId)?.[0]?.some(value => value !== 0));
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const exported = parseMidiFile(bytes, { sampleRate: 8000 });
	const controller = exported.tracks.find(track => !track.notes.length && track.events?.some(event => event.status === 0xb0));
	assert.ok(controller, 'ambiguous control ownership must remain on the auxiliary track through export');
	assert.deepEqual(controller.events?.filter(event => event.status === 0xb0).map(event => event.data), [[7, 0]]);
});
