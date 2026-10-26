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
for (const groupId of ['constructor', 'toString', '__proto__']) test(`NP056: native grouped Copy/Paste preserves reserved identity ${groupId}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const original = createSoundscaperProject({ id: 'clipboard-rate-source', sources: [source],
		clips: [createAudioClip({ id: 'first', groupId, sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 }), createAudioClip({ id: 'second', groupId, sourceId: source.id, timelineStartFrame: 24_000, sourceStartFrame: 24_000, durationFrames: 24_000, sourceDurationFrames: 24_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['first', 'second'] })] });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	const archive = await exportScapeProject(original, archiveStore); assert.ok(archive.blob instanceof Blob);
	await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Hidden stretch.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.setExactSelection(0, 48_000, { trackIds: ['voice'] });
	controller.actions.edit.copy();
	await controller.actions.project.create();
	await controller.actions.edit.paste();
	const pasted: unknown = controller.project; assert.ok(validateSoundscaperProject(pasted));
	assert.equal(pasted.clips.length, 2);
	assert.equal(typeof pasted.clips[0]?.groupId, 'string');
	assert.equal(pasted.clips[0]?.groupId, pasted.clips[1]?.groupId);
	assert.notEqual(pasted.clips[0]?.groupId, groupId);
	controller.actions.edit.undo(); assert.equal(controller.project?.clips.length, 0);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, pasted.clips);
});
