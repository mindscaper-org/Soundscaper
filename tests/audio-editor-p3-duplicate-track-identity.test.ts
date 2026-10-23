/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const trackId of ['__proto__', 'constructor', 'toString', 'voice']) {
	test(`P3-011: Edit Duplicate retains recording placement for native track ${trackId}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
		const clip = createAudioClip({ id: 'clip', title: 'Voice', sourceId: source.id, timelineStartFrame: 4800, durationFrames: 4800, sourceDurationFrames: 4800 });
		const project = createSoundscaperProject({ id: `duplicate-${trackId}`, sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: trackId, name: 'Voice', clipIds: [clip.id] })] });
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Voice.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		controller.actions.timeline.selectClip(clip.id);
		const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
		controller.actions.edit.duplicate();
		const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
		assert.equal(after.tracks.length, 2); assert.equal(after.clips.length, 2);
		const duplicate = after.tracks.find(track => track.id !== trackId); assert.ok(duplicate);
		const copiedIds = duplicate.clipIds; assert.ok(Array.isArray(copiedIds)); assert.equal(copiedIds.length, 1);
		const copied = after.clips.find(clip => clip.id === copiedIds[0]); assert.ok(copied);
		assert.equal(copied.sourceId, before.clips[0]!.sourceId); assert.equal(copied.timelineStartFrame, 4800);
		assert.deepEqual(after.tracks.find(track => track.id === trackId)?.clipIds, [clip.id]);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks); assert.deepEqual(controller.project?.clips, before.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, after.tracks); assert.deepEqual(controller.project?.clips, after.clips);
	});
}
