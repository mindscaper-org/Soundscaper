/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const mode of ['forward', 'reversed', 'warped'] as const) test(`NP005: Detach at silences respects exact selection bounds on a ${mode} stretched clip`, async context => {
	const reversed = mode === 'reversed';
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'silence-source', sampleRate: 48_000, channelCount: 1, frameCount: 5000 });
	const samples = new Float32Array(5000).fill(.5); samples.fill(0, reversed ? 2000 : 1000, reversed ? 4000 : 3000);
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([samples]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: context.name, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['take'] })],
		clips: [createAudioClip({ id: 'take', sourceId: source.id, timelineStartFrame: 0, durationFrames: 15_000,
			sourceDurationFrames: 5000, reversed, ...(mode === 'warped' ? { warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 15_000, source: 5000, mode: 'forward' },
			] } } : {}) })] }));
	controller.actions.timeline.setSelection(3001, 8999, { trackIds: ['voice'] });
	await controller.actions.edit.disjoin();
	const project = controller.project; assert.ok(project);
	const clips = [...resolveRuntimeProjectProjection(project).clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);
	assert.deepEqual(clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]),
		mode === 'warped' ? [[0, 3003], [8997, 6003]] : [[0, 3001], [8999, 6001]]);
	controller.actions.edit.undo();
	assert.equal(controller.project?.clips.length, 1);
	controller.actions.edit.redo();
	assert.equal(controller.project?.clips.length, 2);
});
