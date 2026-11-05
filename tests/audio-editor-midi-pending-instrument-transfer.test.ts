/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';

test('a transfer that can reuse the current tone still joins a previously requested instrument change', async context => {
	const { controller, pcm, holdSourceWrites } = await midiControllerPcmFixture();
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); });
	const first = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(first.clipId, { id: 'note', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000, channel: 0 });
	const second = await controller.actions.midi.addTrack();
	holdSourceWrites(gate, entered);
	const changing = controller.actions.midi.setInstrument(second.trackId, 'sine'); await writing;
	const moving = controller.actions.clip.move(first.clipId, second.trackId, 8000);
	const outcomes = Promise.allSettled([changing, moving]); release();
	assert.deepEqual((await outcomes).map(result => result.status), ['fulfilled', 'fulfilled']);
	assert.equal(readMidiTrack(controller.project!.tracks.find(track => track.id === second.trackId))?.instrument, 'sine');
	const clip = controller.project!.clips.find(value => value.id === first.clipId)!;
	const source = controller.project!.sources.find(value => value.id === clip.sourceId)!;
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, 'sine', Number(source.sampleRate), 0, 2000);
	assert.ok(pcm.get(clip.sourceId)![0]!.subarray(0, 2000).every((sample, index) => Object.is(sample, expected[index])));
});
