/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('Undo cancels MIDI edits already waiting behind a stale source publication', async context => {
	const { controller, holdSourceWrites } = await midiControllerPcmFixture();
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); });
	const owner = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(owner.clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 2000, velocity: 100, channel: 0 });
	await controller.actions.midi.setInstrument(owner.trackId, 'square');
	holdSourceWrites(gate, entered);
	const first = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 67 });
	await writing;
	const next = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 72 });
	await controller.actions.edit.undo();
	const restored = controller.project;
	const outcomes = Promise.allSettled([first, next]);
	release(); const results = await outcomes;
	assert.equal(results[0]?.status, 'rejected', 'an in-flight source already respects the Undo fence');
	assert.strictEqual(controller.project, restored, 'a queued edit must not republish after the same Undo');
	assert.equal(readMidiClip(controller.project!.clips.find(clip => clip.id === owner.clipId))?.notes[0]?.pitch, 60);
	assert.equal(results[1]?.status, 'rejected');
});

test('ordinary queued MIDI commits advance their admitted document while later post-Undo requests remain valid', async context => {
	const { controller, holdSourceWrites } = await midiControllerPcmFixture();
	let release!: () => void, entered!: () => void;
	let gate = new Promise<void>(resolve => { release = resolve; });
	let writing = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); });
	const owner = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(owner.clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 2000, velocity: 100, channel: 0 });
	holdSourceWrites(gate, () => { entered(); });
	const first = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 67 }); await writing;
	const next = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 72 });
	release(); await Promise.all([first, next]);
	assert.equal(readMidiClip(controller.project!.clips.find(clip => clip.id === owner.clipId))?.notes[0]?.pitch, 72);
	gate = new Promise<void>(resolve => { release = resolve; }); writing = new Promise<void>(resolve => { entered = resolve; });
	holdSourceWrites(gate, () => { entered(); });
	const stale = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 74 }); await writing;
	await controller.actions.edit.undo();
	const fresh = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 76 });
	const outcomes = Promise.allSettled([stale, fresh]); release();
	assert.deepEqual((await outcomes).map(result => result.status), ['rejected', 'fulfilled']);
	assert.equal(readMidiClip(controller.project!.clips.find(clip => clip.id === owner.clipId))?.notes[0]?.pitch, 76);
});
