/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const available of [true, false]) test(`NP049: implicit Add label skips locked destinations; available peer=${available}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const project = createSoundscaperProject({ id: 'available-labels', tracks: [
		createAudioTrack({ id: 'voice', name: 'Voice' }),
		{ id: 'locked', name: 'Locked labels', type: 'label', locked: true, labels: [] },
		...(available ? [{ id: 'writable', name: 'Writable labels', type: 'label', labels: [] }] : []),
	] });
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Available labels.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.selectTrack('voice');
	const before = controller.project;
	controller.actions.labels.add();
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	const labeled = result.tracks.filter(track => Array.isArray(track.labels) && track.labels.length === 1);
	assert.equal(labeled.length, 1); assert.notEqual(labeled[0]!.id, 'locked');
	if (available) assert.equal(labeled[0]!.id, 'writable');
	else assert.equal(result.tracks.length, project.tracks.length + 1);
	controller.actions.edit.undo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	const beforeRefusal = controller.project;
	assert.throws(() => controller.actions.labels.add('locked'), /locked/u, 'an explicit locked destination remains a refusal');
	assert.equal(controller.project, beforeRefusal);
});
