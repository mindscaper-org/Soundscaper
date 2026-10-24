/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

test('cross-rate clipboard paste retains the departing gain when envelope points merge', async context => {
	const envelope = [{ frame: 0, value: .2 }, { frame: 10_001, value: .1 }, { frame: 10_002, value: .9 }, { frame: 48_000, value: .9 }];
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const original = createSoundscaperProject({ id: 'paste-envelope-origin', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000, envelope })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const destination = createSoundscaperProject({ id: 'paste-envelope-destination', sampleRate: 24_000 });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	await store.saveProject(original); await store.saveProject(destination);
	await store.saveSetting('last-project-id', original.id);
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en', store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	controller.actions.timeline.setExactSelection(0, 48_000, { trackIds: ['voice'] });
	controller.actions.edit.copy();
	await controller.actions.project.openById(destination.id);
	await controller.actions.edit.paste();
	const pasted = controller.project; assert.ok(pasted);
	assert.equal(pasted.clips.length, 1);
	assert.deepEqual(pasted.clips[0]?.envelope, [{ frame: 0, value: .2 }, { frame: 5_001, value: .9 }, { frame: 24_000, value: .9 }]);
	controller.actions.edit.undo(); assert.equal(controller.project?.clips.length, 0);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, pasted.clips);
});
