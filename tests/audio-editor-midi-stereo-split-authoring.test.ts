/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';
import { createMidiClip } from '../src/common/editor/midi-factory.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { planSplitStereoSources, splitStereoClipCommands } from '../src/common/editor/controller/track-audio/internal/split-stereo-clip-commands.ts';
import { createMemoryFfmpeg, storedChannelSample } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const centered of [false, true]) for (const gain of [0, .5, 1]) test(`MIDI ${centered ? 'centered' : 'L/R'} split retains later authoring at gain ${gain}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .25, channelCount: 2, durationSeconds: .1, frequency: 330 });
	const stereoTrackId = controller.getSnapshot().selectedTrackId; assert.ok(stereoTrackId);
	const midi = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(midi.clipId, { id: 'note', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 4800 });
	await controller.actions.clip.move(midi.clipId, stereoTrackId, 4800);
	await controller.actions.clip.update(midi.clipId, { gain });
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	const original = before.clips.find(clip => clip.id === midi.clipId); assert.ok(original);
	const history = controller.getSnapshot().history.undoEntries.length;
	const split = centered ? await controller.actions.track.splitStereoCenter(stereoTrackId)
		: await controller.actions.track.splitStereoLR(stereoTrackId); assert.ok(split);
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	const notes = after.clips.filter(clip => readMidiClip(clip)); assert.equal(notes.length, 2);
	assert.equal(after.sources.filter(source => !before.sources.some(previous => previous.id === source.id)).length, 2,
		'only the ordinary stereo source requires derived PCM');
	for (const clip of notes) {
		assert.equal(clip.sourceId, original.sourceId, 'authored mono notes retain their raw synthesizer source');
		assert.equal(clip.gain, gain * Math.SQRT1_2, 'the extracted mono contribution stays in the retained clip gain');
	}
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	await controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips); assert.deepEqual(controller.project?.tracks, before.tracks);
	await controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips); assert.deepEqual(controller.project?.tracks, after.tracks);
	await controller.actions.midi.updateNote(midi.clipId, 'note', { velocity: 99 });
	const edited: unknown = controller.project; assert.ok(validateSoundscaperProject(edited));
	const editedClip = edited.clips.find(clip => clip.id === midi.clipId); assert.ok(editedClip);
	assert.equal(editedClip.gain, gain * Math.SQRT1_2);
	const source = edited.sources.find(source => source.id === editedClip.sourceId); assert.ok(source);
	assert.equal(typeof source.sampleRate, 'number'); assert.equal(typeof source.storageKey, 'string');
	if (typeof source.sampleRate !== 'number' || typeof source.storageKey !== 'string') assert.fail('Expected stored native PCM.');
	const instrument = readMidiTrack(edited.tracks.find(track => track.id === split.leftTrackId)); assert.ok(instrument);
	const expected = renderMidiFrames(readMidiClip(editedClip)!.notes, instrument.instrument, source.sampleRate, 1234, 1);
	assert.ok(Math.abs(expected[0]!) > .001, 'the raw synthesis comparison uses an audible sample');
	assert.equal(await storedChannelSample(store, source.storageKey, 0, 1234), expected[0]);
	const right = edited.clips.find(clip => clip.id !== midi.clipId && readMidiClip(clip)); assert.ok(right);
	assert.equal(right.sourceId, original.sourceId); assert.equal(readMidiClip(right)?.notes[0]?.velocity, 100);
});

test('shared ordinary and MIDI mono sources derive only the ordinary clips', () => {
	const source = createAudioSource({ id: 'shared', frameCount: 100, sampleRate: 16000, channelCount: 1 });
	const midi = { ...createMidiClip({ id: 'midi', sourceId: source.id, durationFrames: 100 }), timelineStartFrame: 0, durationFrames: 100 };
	const audio = createAudioClip({ id: 'audio', sourceId: source.id, durationFrames: 100, timelineStartFrame: 0 });
	const clips = [midi, { ...audio, timelineStartFrame: 0, durationFrames: 100 }];
	const plan = planSplitStereoSources(clips, [source]);
	assert.deepEqual(plan.sourcesToSplit, [source]);
	assert.deepEqual(planSplitStereoSources([midi], [source]).sourcesToSplit, []);
	const pair = { left: createAudioSource({ ...source, id: 'left' }), right: createAudioSource({ ...source, id: 'right' }) };
	for (const clip of clips) {
		const commands = splitStereoClipCommands('left-track', 'right-track', clip, source, pair, () => 'right-clip', 'Right');
		for (const [index, command] of commands.entries()) {
			assert.equal(command.type, 'clip/add'); if (command.type !== 'clip/add') assert.fail('Expected clip creation.');
			assert.equal(command.clip.sourceId, clip.id === midi.id ? source.id : index === 0 ? pair.left.id : pair.right.id);
			assert.equal(command.clip.gain, clip.id === midi.id ? Math.SQRT1_2 : 1);
		}
	}
});

test('retained MIDI source clocks, loops and hidden stretch anchors are not rewritten', () => {
	const source = createAudioSource({ id: 'raw', frameCount: 100, sampleRate: 16000, channelCount: 1 });
	const base = { ...createMidiClip({ id: 'midi', sourceId: source.id, durationFrames: 180, sourceDurationFrames: 60, sourceStartFrame: 20,
		timelineStartFrame: 4800, reversed: true, gain: .8, opaqueExtensions: { 'org.soundscaper.clipSourceStretch': {
			sourceId: source.id, sourceFrameCount: 100, map: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 300, source: 100, mode: 'forward' },
			] },
		} } }), timelineStartFrame: 4800, durationFrames: 180 };
	const clip = { ...base, ...clipLoopUpdateFields(base, { periodFrames: 180, durationFrames: 360, offsetFrames: 30 }) };
	const pair = { left: createAudioSource({ id: 'left', frameCount: 50, sampleRate: 8000, channelCount: 1 }), right: createAudioSource({ id: 'right', frameCount: 50, sampleRate: 8000, channelCount: 1 }) };
	for (const command of splitStereoClipCommands('left-track', 'right-track', clip, source, pair, () => 'copy', 'Right')) {
		assert.equal(command.type, 'clip/add'); if (command.type !== 'clip/add') assert.fail('Expected clip creation.');
		assert.equal(command.clip.sourceId, source.id); assert.equal(command.clip.gain, .8 * Math.SQRT1_2);
		for (const field of ['timelineStartFrame', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames', 'reversed', 'opaqueExtensions'] as const) {
			assert.deepEqual(command.clip[field], clip[field]);
		}
	}
});

test('stereo MIDI carriers keep the existing channel extraction policy', () => {
	const source = createAudioSource({ id: 'stereo', frameCount: 100, sampleRate: 16000, channelCount: 2 });
	const clip = { ...createMidiClip({ sourceId: source.id, durationFrames: 100, gain: .5 }), timelineStartFrame: 0, durationFrames: 100 };
	const pair = { left: createAudioSource({ ...source, id: 'left', channelCount: 1 }), right: createAudioSource({ ...source, id: 'right', channelCount: 1 }) };
	assert.deepEqual(planSplitStereoSources([clip], [source]).sourcesToSplit, [source]);
	for (const [index, command] of splitStereoClipCommands('left-track', 'right-track', clip, source, pair, () => 'copy', 'Right').entries()) {
		assert.equal(command.type, 'clip/add'); if (command.type !== 'clip/add') assert.fail('Expected clip creation.');
		assert.equal(command.clip.sourceId, index === 0 ? pair.left.id : pair.right.id); assert.equal(command.clip.gain, .5);
	}
});
