/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, audioBuffer, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP28: Make Stereo preserves mute and solo when merging the two tracks', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-track-transforms' });
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
	await controller.actions.track.makeStereo('left', 'right');
	const merged = controller.project?.tracks.find(({ id }) => id === 'left');
	assert.equal(merged?.mute, true);
	assert.equal(merged?.solo, true);
	controller.actions.edit.undo();
	controller.actions.track.update('right', { mute: false });
	await assert.rejects(controller.actions.track.makeStereo('left', 'right'), /mono tracks/iu);
	assert.equal(controller.project?.tracks.length, 2);
});
