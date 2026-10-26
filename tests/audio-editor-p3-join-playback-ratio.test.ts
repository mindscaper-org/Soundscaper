/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { canJoinClips } from '../src/common/editor/commands/clip-link-runtime.js';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const unequal of [false, true]) for (const anchor of ['sample', 'musical'] as const) test(`Join preserves native ${anchor} playback geometry (${unequal ? 'unequal' : 'equal'} ratios)`, async context => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const clips = [0, 1].map(index => createAudioClip({ id: `part-${String(index)}`, title: `Part ${String(index + 1)}`,
		sourceId: source.id, sourceStartFrame: index * 48_000, sourceDurationFrames: 48_000, anchor,
		...(anchor === 'musical' ? { musicalStartBeat: index * 2, musicalDurationBeats: unequal && index === 1 ? 1 : 2, musicalExtent: 'beat' }
			: { timelineStartFrame: index * 48_000, durationFrames: unequal && index === 1 ? 24_000 : 48_000 }) }));
	const project = createSoundscaperProject({ id: context.name, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', clipIds: clips.map(clip => clip.id) })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: clips.map(clip => clip.id) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let start = 0; start < source.frameCount; start += 65_536) await writer.write([new Float32Array(Math.min(65_536, source.frameCount - start)).fill(.25)]);
	await writer.commit(); const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Join.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const before = structuredClone(controller.project); assert.ok(before);
	assert.equal(canJoinClips(before, clips.map(clip => clip.id)), !unequal);
	if (unequal) {
		assert.throws(() => applySoundscaperProjectCommand(project, { type: 'clip/join', clipIds: clips.map(clip => clip.id) }), /processing|source timing|render/iu);
		controller.actions.edit.join();
		assert.deepEqual(controller.project, before);
	} else {
		controller.actions.edit.join(); assert.equal(controller.project?.clips.length, 1);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
		controller.actions.edit.redo(); assert.equal(controller.project?.clips.length, 1);
	}
});

for (const sourceRate of [44_100, 96_000]) test(`Join retains a rounded ${String(sourceRate)}Hz source split`, () => {
	const source = createAudioSource({ id: 'source', sampleRate: sourceRate, frameCount: sourceRate, channelCount: 1 });
	const project = createSoundscaperProject({ sources: [source], clips: [createAudioClip({ id: 'whole', sourceId: source.id,
		durationFrames: 48_000, sourceDurationFrames: sourceRate })], tracks: [createAudioTrack({ id: 'voice', clipIds: ['whole'] })] });
	const split = applySoundscaperProjectCommand(project, { type: 'clip/split', clipId: 'whole', atFrame: 24_001, rightClipId: 'right' });
	assert.equal(canJoinClips(split, ['whole', 'right']), true);
	const joined = applySoundscaperProjectCommand(split, { type: 'clip/join', clipIds: ['whole', 'right'] });
	assert.deepEqual(joined.clips, project.clips);
});

