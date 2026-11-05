/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture as controllerFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';

test('moving MIDI into an existing instrument lane keeps playable PCM consistent with that owner', async () => {
	const f = midiServiceFixture();
	const first = await f.service.addTrack();
	await f.service.addNote(first.clipId, { id: 'tone', pitch: 69, velocity: 100, channel: 0,
		startFrame: 0, durationFrames: 2_000 });
	await f.service.setInstrument(first.trackId, 'square');
	const second = await f.service.addTrack();
	await f.service.setInstrument(second.trackId, 'sine');
	await f.service.commitTransfer({ type: 'clip/move', clipId: first.clipId, trackId: second.trackId, timelineStartFrame: 0 },
		command => applyEditorCommand(f.project(), command));
	const clip = f.project().clips.find(candidate => candidate.id === first.clipId)!;
	const destination = f.project().tracks.find(track => track.id === second.trackId)!;
	const owner = readMidiTrack(destination)!;
	assert.equal(owner.instrument, 'sine');
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, owner.instrument, 8_000, 0, 2_000);
	const actual = f.pcm.get(clip.sourceId)![0]!.subarray(0, 2_000);
	assert.ok(actual.every((sample, index) => Object.is(sample, expected[index])),
		'the audible fallback must use the instrument shown by the destination lane');
});

for (const route of ['timeline', 'inspector'] as const) test(`a normal ${route} MIDI transfer publishes its new tone and geometry in one Undo step`, async context => {
	const { controller, pcm } = await controllerFixture();
	context.after(async () => { await controller.dispose(); });
	const first = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(first.clipId, { id: 'note', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000, channel: 0 });
	await controller.actions.midi.setInstrument(first.trackId, 'square');
	const second = await controller.actions.midi.addTrack();
	await controller.actions.midi.setInstrument(second.trackId, 'sine');
	const oldSource = controller.project!.clips.find(clip => clip.id === first.clipId)!.sourceId;
	if (route === 'timeline') await controller.actions.clip.move(first.clipId, second.trackId, 8000);
	else await controller.actions.edit.commit({ type: 'batch', commands: [{ type: 'clip/move',
		clipId: first.clipId, trackId: second.trackId, timelineStartFrame: 8000 }] });
	const clip = controller.project!.clips.find(value => value.id === first.clipId)!;
	const source = controller.project!.sources.find(value => value.id === clip.sourceId)!;
	assert.equal(clip.timelineStartFrame, 8000);
	assert.ok(controller.project!.tracks.some(track => track.id === second.trackId && Array.isArray(track.clipIds) && track.clipIds.includes(first.clipId)));
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, 'sine', Number(source.sampleRate), 0, 2000);
	assert.ok(pcm.get(clip.sourceId)![0]!.subarray(0, 2000).every((sample, index) => Object.is(sample, expected[index])));
	const replacement = clip.sourceId;
	await controller.actions.edit.undo();
	const restored = controller.project!.clips.find(value => value.id === first.clipId)!;
	assert.equal(restored.sourceId, oldSource);
	assert.equal(restored.timelineStartFrame, 0);
	assert.ok(controller.project!.tracks.some(track => track.id === first.trackId && Array.isArray(track.clipIds) && track.clipIds.includes(first.clipId)));
	await controller.actions.edit.redo();
	assert.equal(controller.project!.clips.find(value => value.id === first.clipId)!.sourceId, replacement);
});

for (const route of ['duplicate', 'clipboard', 'project-bin'] as const) test(`${route} MIDI transfer uses its destination instrument and one publication`, async context => {
	const { controller, pcm } = await controllerFixture();
	context.after(async () => { await controller.dispose(); });
	const first = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(first.clipId, { id: 'note', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000, channel: 0 });
	await controller.actions.midi.setInstrument(first.trackId, 'square');
	const second = await controller.actions.midi.addTrack();
	await controller.actions.midi.setInstrument(second.trackId, 'sine');
	if (route === 'clipboard') {
		controller.actions.timeline.selectClip(first.clipId);
		await controller.actions.edit.copy();
		controller.actions.timeline.selectTrack(second.trackId);
		controller.actions.transport.seek(8000);
	}
	let binId: string | undefined;
	if (route === 'project-bin') binId = controller.actions.projectBin.moveFromTimeline(first.clipId)?.[0];
	const before = controller.project!;
	if (route === 'duplicate') await controller.actions.clip.move(first.clipId, second.trackId, 8000, { duplicate: true });
	if (route === 'clipboard') await controller.actions.edit.pasteOverlap();
	if (route === 'project-bin') { assert.ok(binId); await controller.actions.projectBin.place(binId, { trackId: second.trackId, timelineStartFrame: 8000 }); }
	const owner = controller.project!.tracks.find(track => track.id === second.trackId)!;
	const clip = controller.project!.clips.find(value => Array.isArray(owner.clipIds) && owner.clipIds.includes(value.id) && readMidiClip(value)?.notes.length)!;
	assert.ok(clip, 'the normal transfer publishes an editable note clip');
	const source = controller.project!.sources.find(value => value.id === clip.sourceId)!;
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, 'sine', Number(source.sampleRate), 0, 2000);
	assert.ok(pcm.get(clip.sourceId)![0]!.subarray(0, 2000).every((sample, index) => Object.is(sample, expected[index])), route);
	await controller.actions.edit.undo();
	assert.deepEqual(controller.project!.clips, before.clips);
	assert.deepEqual(controller.project!.tracks, before.tracks);
});

test('MIDI transfer compilation preserves a foreign native source clock and musical geometry', async () => {
	const f = midiServiceFixture({ sources: [createAudioSource({ id: 'native', sampleRate: 16000, frameCount: 16000, channelCount: 1 })],
		clips: [{ ...createMidiClip({ id: 'clip', sourceId: 'native', sourceDurationFrames: 16000, durationFrames: 16000, anchor: 'musical',
			musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 },
			notes: [{ id: 'note', pitch: 69, startFrame: 0, durationFrames: 4000, velocity: 100, channel: 0 }] }) }],
		tracks: [{ ...createMidiTrack({ id: 'square', instrument: 'square', clipIds: ['clip'] }, 8000) },
			{ ...createMidiTrack({ id: 'sine', instrument: 'sine' }, 8000) }],
	});
	await f.service.commitTransfer({ type: 'clip/move', clipId: 'clip', trackId: 'sine', timelineStartFrame: 16000 },
		command => applyEditorCommand(f.project(), command));
	const clip = f.project().clips[0]!;
	const source = f.project().sources.find(value => value.id === clip.sourceId)!;
	assert.equal(source.sampleRate, 16000);
	assert.equal(source.frameCount, 16000);
	assert.deepEqual(clip.musicalDurationBeats, { num: 4, den: 1 });
	assert.equal(clip.sourceDurationFrames, 16000);
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, 'sine', 16000, 0, 4000);
	assert.ok(f.pcm.get(clip.sourceId)![0]!.subarray(0, 4000).every((sample, index) => Object.is(sample, expected[index])));
});

test('Save and later note edits join the same pending MIDI transfer queue', async context => {
	const fixture = await controllerFixture();
	const { controller, pcm } = fixture;
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); });
	const first = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(first.clipId, { id: 'note', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000, channel: 0 });
	await controller.actions.midi.setInstrument(first.trackId, 'square');
	const second = await controller.actions.midi.addTrack();
	await controller.actions.midi.setInstrument(second.trackId, 'sine');
	fixture.holdSourceWrites(gate, entered);
	const moving = controller.actions.clip.move(first.clipId, second.trackId, 8000);
	await writing;
	const editing = controller.actions.midi.updateNote(first.clipId, 'note', { pitch: 72 });
	const saving = controller.actions.project.save();
	release(); await Promise.all([moving, editing, saving]);
	const clip = controller.project!.clips.find(value => value.id === first.clipId)!;
	assert.equal(readMidiClip(clip)?.notes[0]?.pitch, 72);
	assert.ok(controller.project!.tracks.some(value => value.id === second.trackId && Array.isArray(value.clipIds) && value.clipIds.includes(first.clipId)));
	const source = controller.project!.sources.find(value => value.id === clip.sourceId)!;
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, 'sine', Number(source.sampleRate), 0, 2000);
	assert.ok(pcm.get(clip.sourceId)![0]!.subarray(0, 2000).every((sample, index) => Object.is(sample, expected[index])));
	const saved = await fixture.store.loadProject(controller.project!.id);
	assert.equal(saved.clips.find((value: { id: string }) => value.id === first.clipId)?.sourceId, clip.sourceId);
});

test('Undo during MIDI transfer rendering cancels publication and cleans its staged source', async context => {
	const fixture = await controllerFixture();
	const { controller, pcm } = fixture;
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); });
	const first = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(first.clipId, { id: 'note', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000, channel: 0 });
	await controller.actions.midi.setInstrument(first.trackId, 'square');
	const second = await controller.actions.midi.addTrack();
	await controller.actions.midi.setInstrument(second.trackId, 'sine');
	const retained = pcm.size;
	fixture.holdSourceWrites(gate, entered);
	const moving = controller.actions.clip.move(first.clipId, second.trackId, 8000);
	await writing;
	await controller.actions.edit.undo();
	const restored = controller.project;
	const refusal = assert.rejects(Promise.resolve(moving), /project changed/iu);
	release(); await refusal;
	assert.strictEqual(controller.project, restored);
	assert.equal(pcm.size, retained);
});

for (const rate of [48000, 24000]) test(`cross-project MIDI paste into an ordinary${rate}Hz destination compiles its imported owner`, async context => {
	const { controller, pcm } = await controllerFixture();
	context.after(async () => { await controller.dispose(); });
	const first = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(first.clipId, { id: 'note', pitch: 69, velocity: 100, startFrame: 0, durationFrames: 2000, channel: 0 });
	await controller.actions.midi.setInstrument(first.trackId, 'square');
	controller.actions.timeline.selectClip(first.clipId); await controller.actions.edit.copy();
	await controller.actions.project.create({ sampleRate: rate });
	assert.ok(controller.project!.tracks.every(track => !readMidiTrack(track)));
	await controller.actions.edit.pasteOverlap();
	const clip = controller.project!.clips.find(value => readMidiClip(value)?.notes.length)!;
	assert.ok(clip);
	const owner = controller.project!.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id))!;
	assert.equal(readMidiTrack(owner)?.instrument, 'square');
	const source = controller.project!.sources.find(value => value.id === clip.sourceId)!;
	assert.equal(source.sampleRate, 48000);
	const expected = renderMidiFrames(readMidiClip(clip)!.notes, 'square', 48000, 0, 2000);
	assert.ok(pcm.get(clip.sourceId)![0]!.subarray(0, 2000).every((sample, index) => Object.is(sample, expected[index])));
	await controller.actions.edit.undo();
	assert.equal(controller.project!.clips.length, 0);
	assert.ok(controller.project!.tracks.every(track => !readMidiTrack(track)));
});

test('ordinary audio move and clipboard publication retain the synchronous commit without MIDI synthesis', async context => {
	const { controller, pcm, store } = await controllerFixture();
	context.after(async () => { await controller.dispose(); });
	const trackId = controller.project!.tracks.find(track => track.type === 'audio')!.id;
	const source = createAudioSource({ id: 'ordinary', sampleRate: 48000, frameCount: 2000, channelCount: 1 });
	store.audioSources.set(source.id, [new Float32Array(2000).fill(0.25)]);
	controller.actions.edit.commit({ type: 'batch', commands: [{ type: 'source/add', source: { ...source } },
		{ type: 'clip/add', trackId, clip: { ...createAudioClip({ id: 'ordinary-clip', sourceId: source.id, durationFrames: 2000, sourceDurationFrames: 2000 }) } }] });
	const moving = controller.actions.clip.move('ordinary-clip', trackId, 4000);
	assert.ok(!(moving instanceof Promise), 'the ordinary clip commit remains synchronous');
	controller.actions.timeline.selectClip('ordinary-clip'); await controller.actions.edit.copy();
	await controller.actions.project.create(); await controller.actions.edit.pasteOverlap();
	assert.equal(controller.project!.clips.length, 1);
	assert.ok(controller.project!.clips.every(clip => !readMidiClip(clip)));
	assert.equal(pcm.size, 0, 'ordinary audio does not allocate synthesized MIDI sources');
});
