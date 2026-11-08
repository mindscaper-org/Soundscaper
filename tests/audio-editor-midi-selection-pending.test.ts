/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

for (const queued of [false, true]) test(`selection preserves ${queued ? 'queued and active' : 'active'} MIDI note edits and the latest selected clip`, async context => {
	const { controller, holdSourceWrites } = await midiControllerPcmFixture();
	const release = deferred<void>(), entered = deferred<void>();
	context.after(async () => { release.resolve(); await controller.dispose(); });
	const owner = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(owner.clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 2000, velocity: 100, channel: 0 });
	const other = await controller.actions.midi.addTrack();
	controller.actions.timeline.selectClip(owner.clipId);
	holdSourceWrites(release.promise, () => { entered.resolve(); });
	const first = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 67 });
	await entered.promise;
	const next = queued ? controller.actions.midi.updateNote(owner.clipId, 'note', { velocity: 80 }) : Promise.resolve();
	controller.actions.timeline.selectClip(other.clipId);
	release.resolve();
	await Promise.all([first, next]);
	const note = readMidiClip(controller.project!.clips.find(clip => clip.id === owner.clipId))?.notes[0];
	assert.equal(note?.pitch, 67);
	assert.equal(note?.velocity, queued ? 80 : 100);
	assert.deepEqual(controller.project!.selection.clipIds, [other.clipId]);
	assert.equal(controller.getSnapshot().selectedClipId, other.clipId);
});

test('selection before the lazy MIDI service loads preserves the requested edit', async context => {
	const { controller } = await midiControllerPcmFixture();
	context.after(async () => { await controller.dispose(); });
	const adding = controller.actions.midi.addTrack();
	controller.actions.timeline.setSelection(100, 200);
	const owner = await adding;
	assert.ok(controller.project!.clips.some(clip => clip.id === owner.clipId));
});

test('selection after Undo does not revive a stale MIDI render', async context => {
	const { controller, holdSourceWrites } = await midiControllerPcmFixture();
	const release = deferred<void>(), entered = deferred<void>();
	context.after(async () => { release.resolve(); await controller.dispose(); });
	const owner = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(owner.clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 2000, velocity: 100, channel: 0 });
	const other = await controller.actions.midi.addTrack();
	await controller.actions.midi.setInstrument(owner.trackId, 'square');
	holdSourceWrites(release.promise, () => { entered.resolve(); });
	const updating = controller.actions.midi.updateNote(owner.clipId, 'note', { pitch: 67 });
	const outcome = Promise.allSettled([updating]);
	await entered.promise;
	await controller.actions.edit.undo();
	controller.actions.timeline.selectClip(other.clipId);
	const restored = controller.project;
	release.resolve();
	assert.equal((await outcome)[0]?.status, 'rejected');
	assert.strictEqual(controller.project, restored);
});
