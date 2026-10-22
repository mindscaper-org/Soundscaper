/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('NP008: Duplicate track retains unflattened recorded takes and the selected comp', async context => {
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
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'voice', startSample: 0, endSample: 4800,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 4800, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 4800 }] }] }));
	const original = controller.project; assert.ok(original);
	controller.actions.track.duplicate('voice');
	const duplicated = controller.project; assert.ok(duplicated);
	const targetId = controller.getSnapshot().selectedTrackId; assert.ok(targetId && targetId !== 'voice');
	assert.equal(duplicated.takeGroups.length, 2, 'the copy must carry the recorded audio that has no ordinary clip yet');
	const group = duplicated.takeGroups.find(item => item.trackId === targetId); assert.ok(group);
	assert.notEqual(group.id, original.takeGroups[0]?.id);
	assert.equal(group.takes[0]?.sourceId, source.id);
	assert.equal(group.compRegions[0]?.takeId, group.takes[0]?.id);
	assert.equal(group.takes[0]?.laneId, group.lanes[0]?.id);
	assert.deepEqual(group.laneOrder, group.lanes.map(lane => lane.id));
	const allIds = duplicated.takeGroups.flatMap(item => [item.id, ...item.lanes.map(lane => lane.id), ...item.takes.map(take => take.id), ...item.compRegions.map(region => region.id)]);
	assert.equal(new Set(allIds).size, allIds.length);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.takeGroups, original.takeGroups);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.takeGroups, duplicated.takeGroups);
});
