/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const reversed of [true, false]) test(`Join preserves valid hidden source custody for independently trimmed clips; reversed=${String(reversed)}`, async context => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 100_000, channelCount: 1 });
	const clips = [0, 1].map(index => {
		const start = reversed ? 50_000 - index * 10_000 : 40_000 + index * 10_000;
		return createAudioClip({ id: `clip-${String(index)}`, title: `Part ${String(index + 1)}`, sourceId: source.id,
			timelineStartFrame: index * 10_000, durationFrames: 10_000, sourceStartFrame: start, sourceDurationFrames: 10_000,
			trimStartFrames: start, trimEndFrames: source.frameCount - start - 10_000, reversed });
	});
	const project = createSoundscaperProject({ id: context.name, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: clips.map(clip => clip.id) })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: clips.map(clip => clip.id) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let offset = 0; offset < source.frameCount; offset += 65_536) await writer.write([new Float32Array(Math.min(65_536, source.frameCount - offset)).fill(.25)]);
	await writer.commit(); const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Trimmed.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const before = structuredClone(controller.project); assert.ok(before);
	await controller.actions.edit.join();
	const joined = controller.project?.clips[0]; assert.ok(joined);
	assert.equal(controller.project?.clips.length, 1);
	assert.equal(joined.sourceStartFrame, 40_000); assert.equal(joined.sourceDurationFrames, 20_000);
	assert.equal(joined.trimStartFrames, 40_000); assert.equal(joined.trimEndFrames, 40_000);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips.length, 1);
	const persisted = await controller.actions.project.flush(); assert.notEqual(persisted, null);
});

for (const reversed of [true, false]) for (const loop of [true, false]) test(`split and Join retain an existing nonzero hidden window; reversed=${String(reversed)}, loop=${String(loop)}`, () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 100_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, durationFrames: 20_000,
		sourceStartFrame: 40_000, sourceDurationFrames: 20_000, trimStartFrames: 40_000, trimEndFrames: 40_000, reversed });
	const base = createSoundscaperProject({ sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const project = loop ? applySoundscaperProjectCommand(base, { type: 'clip/update', clipId: clip.id,
		changes: { loop: { periodFrames: 20_000, durationFrames: 40_000 } } }) : base;
	const split = applySoundscaperProjectCommand(project, { type: 'clip/split', clipId: clip.id, atFrame: 10_000, rightClipId: 'right' });
	const joined = applySoundscaperProjectCommand(split, { type: 'clip/join', clipIds: ['clip', 'right'] });
	assert.deepEqual(joined.clips, project.clips);
});
