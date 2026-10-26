/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const operation of ['delete', 'overwrite', 'drag-overwrite', 'paste-overlap', 'paste-insert'] as const)
	for (const clipId of ['__proto__', 'constructor', 'toString', 'ordinary']) test(`File Open preserves ${operation} split identities for ${clipId}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `split-identity-${clipId}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: operation === 'delete' ? [clipId] : [clipId, 'moving'] })],
		clips: [createAudioClip({ id: clipId, sourceId: source.id, title: 'Recorded voice', timelineStartFrame: 0,
			durationFrames: 48_000, sourceDurationFrames: 48_000 }),
			...(operation === 'delete' ? [] : [createAudioClip({ id: 'moving', sourceId: source.id,
				timelineStartFrame: 96_000, durationFrames: 12_000, sourceDurationFrames: 12_000 })])] });
	assert.equal(validateSoundscaperProject(project), true);
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	const archive = await exportScapeProject(project, archiveStore); assert.ok(archive.blob instanceof Blob);
	await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Voice.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const before = controller.project?.clips;
	if (operation === 'delete') {
		controller.actions.timeline.setExactSelection(12_000, 24_000, { trackIds: ['voice'] });
		controller.actions.edit.deleteLeaveGap();
	} else if (operation === 'paste-overlap' || operation === 'paste-insert') {
		controller.actions.timeline.selectClip('moving');
		await controller.actions.edit.copy();
		controller.actions.timeline.setExactSelection(12_000, 12_000, { trackIds: ['voice'] });
		controller.actions.transport.seek(12_000);
		if (operation === 'paste-overlap') await controller.actions.edit.pasteOverlap();
		else await controller.actions.edit.pasteInsert();
	} else if (operation === 'overwrite') controller.actions.clip.overwrite('moving', 'voice', { timelineStartFrame: 12_000 });
	else controller.actions.clip.move('moving', 'voice', 12_000, { overwrite: true, exactFrame: true });
	const edited: unknown = controller.project; assert.ok(validateSoundscaperProject(edited));
	const expectedCount = operation === 'delete' ? 2 : operation === 'paste-insert' ? 4 : 3;
	assert.equal(edited.clips.length, expectedCount);
	assert.ok(edited.clips.some(clip => clip.id === clipId));
	assert.equal(new Set(edited.clips.map(clip => clip.id)).size, expectedCount);
	if (operation === 'paste-insert') assert.deepEqual(edited.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames])
		.sort((left, right) => left[0]! - right[0]!), [[0, 12_000], [12_000, 12_000], [24_000, 36_000], [108_000, 12_000]]);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, edited.clips);
});
