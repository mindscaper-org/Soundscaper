/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const action of ['deleteLeaveGap', 'deletePerTrackRipple', 'cutLeaveGap'] as const) test(`NP012: ${action} can remove an entire recorded take group`, async context => {
	const startSample = 9600, endSample = startSample + 4800;
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'recorded', frameCount: 4800, sampleRate: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'recording', sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'voice', startSample, endSample,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample, endSample, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample, endSample }] }] }));
	controller.actions.timeline.setSelection(startSample, endSample, { trackIds: ['voice'] });
	const original: unknown = controller.project; assert.ok(validateSoundscaperProject(original));
	await controller.actions.edit[action]();
	const removed: unknown = controller.project; assert.ok(validateSoundscaperProject(removed));
	assert.equal(removed.takeGroups.length, 0);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.takeGroups, original.takeGroups);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.takeGroups, removed.takeGroups);
	if (action === 'cutLeaveGap') {
		await controller.actions.project.create({ title: 'Destination' }); await controller.actions.edit.paste();
		const pasted: unknown = controller.project; assert.ok(validateSoundscaperProject(pasted));
		assert.equal(pasted.takeGroups.length, 1);
		assert.equal(pasted.takeGroups[0]?.takes[0]?.sourceId, source.id);
	}
});
