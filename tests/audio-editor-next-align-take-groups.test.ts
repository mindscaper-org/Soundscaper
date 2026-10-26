/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const mode of ['standalone', 'clips', 'multiple'] as const) test(`NP010: Align moves ${mode} take graphs atomically`, async context => {
	const clips = mode === 'clips';
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
	await controller.actions.project.open(createSoundscaperProject({ id: 'recording', sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: clips ? ['material'] : [] })],
		clips: clips ? [createAudioClip({ id: 'material', sourceId: source.id, timelineStartFrame: startSample, durationFrames: 4800, sourceDurationFrames: 4800 })] : [],
		sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'voice', startSample, endSample,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample, endSample, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample, endSample }] }] }));
	controller.actions.timeline.selectTrack('voice');
	if (mode === 'multiple') {
		controller.actions.takeComp.createGroup({ id: 'group2', sequenceId: 'main', trackId: 'voice', startSample: 19200, endSample: 24000,
			laneOrder: ['lane2'], lanes: [{ id: 'lane2' }], takes: [{ id: 'take2', laneId: 'lane2', sourceId: source.id,
				startSample: 19200, endSample: 24000, sourceStartSample: 0 }], compRegions: [{ id: 'region2', takeId: 'take2', startSample: 19200, endSample: 24000 }] });
		controller.actions.timeline.setSelection(0, 19200, { trackIds: ['voice'] });
	}
	const original: unknown = controller.project; assert.ok(validateSoundscaperProject(original));
	if (mode === 'multiple') controller.actions.track.alignStartToSelectionEnd();
	else controller.actions.track.alignStartToZero();
	const aligned: unknown = controller.project; assert.ok(validateSoundscaperProject(aligned));
	const group = aligned.takeGroups[0]; assert.ok(group);
	const target = mode === 'multiple' ? 19200 : 0;
	assert.deepEqual([group.startSample, group.endSample], [target, target + 4800]);
	assert.deepEqual(group.takes.map(take => [take.startSample, take.endSample, take.sourceStartSample]), [[target, target + 4800, 0]]);
	assert.deepEqual(group.compRegions.map(region => [region.startSample, region.endSample]), [[target, target + 4800]]);
	if (mode === 'multiple') assert.deepEqual(aligned.takeGroups.map(item => [item.startSample, item.endSample]), [[19200, 24000], [28800, 33600]]);
	if (clips) assert.equal(resolveRuntimeProjectProjection(aligned).clips[0]?.timelineStartFrame, 0);
	assert.equal(aligned.revision, original.revision + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.takeGroups, original.takeGroups);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.takeGroups, aligned.takeGroups);
});
