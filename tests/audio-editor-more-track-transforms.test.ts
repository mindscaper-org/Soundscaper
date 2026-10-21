/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, audioBuffer, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

async function openedMonoPair(context: TestContext, databaseName: string) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName });
	const source = createAudioSource({ id: 'original', frameCount: 4, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write([new Float32Array(4).fill(0.25)]); await writer.commit({ sampleRate: 48_000, channelCount: 1 });
	const clips = ['left', 'right'].map((id) => createAudioClip({ id: `${id}-clip`, sourceId: source.id,
		timelineStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 }));
	const project = createSoundscaperProject({ id: 'stereo-project', sources: [source], clips,
		tracks: ['left', 'right'].map((id) => createAudioTrack({ id, name: id, mute: true, solo: true, clipIds: [`${id}-clip`] })) });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: (async () => audioBuffer([new Float32Array(4).fill(0.25)], 48_000)) as Options['renderSnapshot'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	return controller;
}

test('MP28: Make Stereo preserves mute and solo when merging the two tracks', async (context) => {
	const controller = await openedMonoPair(context, 'more-track-transforms');
	await controller.actions.track.makeStereo('left', 'right');
	const merged = controller.project?.tracks.find(({ id }) => id === 'left');
	assert.equal(merged?.mute, true);
	assert.equal(merged?.solo, true);
	controller.actions.edit.undo();
	controller.actions.track.update('right', { mute: false });
	await assert.rejects(controller.actions.track.makeStereo('left', 'right'), /mono tracks/iu);
	assert.equal(controller.project?.tracks.length, 2);
});

test('MP30: Make Stereo refuses unequal channel routing before discarding the right track route', async (context) => {
	const controller = await openedMonoPair(context, 'more-track-routing');
	for (const id of ['left', 'right']) controller.actions.track.update(id, { mute: false, solo: false });
	const mixer = normalizeMixerGraphV21(controller.project?.mixer);
	controller.actions.edit.commit({ type: 'mixer-graph/set', expected: mixer, mixer: {
		...mixer, edges: mixer.edges.map((edge) => edge.source.kind === 'track' && edge.source.id === 'right'
			? { ...edge, level: 0.5 } : edge),
	} });
	await assert.rejects(controller.actions.track.makeStereo('left', 'right'), /mono tracks/iu);
	assert.equal(controller.project?.tracks.length, 2);
	controller.actions.edit.commit({ type: 'mixer-graph/set', expected: normalizeMixerGraphV21(controller.project?.mixer), mixer });
	for (const trackId of ['right', 'left']) {
		const lane = normalizeAutomationLaneV21({ id: `${trackId}-ride`,
			address: { kind: 'edge', edgeId: `assignment:track:${trackId}:master`, parameterId: 'level' },
			timebase: 'absolute-samples', points: [{ id: `${trackId}-point`, position: 0, value: 0.5 }], segments: [] });
		controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane: { ...lane } });
		if (trackId === 'right') await assert.rejects(controller.actions.track.makeStereo('left', 'right'), /mono tracks/iu);
	}
	await controller.actions.track.makeStereo('left', 'right');
	assert.equal(controller.project?.tracks.length, 1, 'matching route automation can be shared by the stereo pair');
});
