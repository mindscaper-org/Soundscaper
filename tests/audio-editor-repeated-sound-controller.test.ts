/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('the public analyzer adds sample-timed labels, repeats its threshold, and undoes each track atomically', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'repeated-sound-controller' });
	const source = createAudioSource({ id: 'podcast', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const sample = Float32Array.from({ length: 1920 }, (_, i) => Math.sin(i * i) * .3);
	const pcm = new Float32Array(source.frameCount); pcm.set(sample, 4800); pcm.set(sample, 24_000);
	const writer = await store.beginSourceWrite(source.id, source); await writer.write([pcm]); await writer.commit();
	const project = createSoundscaperProject({ id: 'repeat-project', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: (() => ({ ...createMemoryRenderEngine(), renderMix: async (range: { startFrame: number; endFrame: number }) => {
			const data = pcm.slice(range.startFrame, range.endFrame);
			return { length: data.length, sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => data };
		} })) as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(4800, 6720, { trackIds: ['voice'] });
	const result = await controller.actions.analysis.findRepeatedSound({ similarityThreshold: .98 });
	assert.deepEqual(result.matches.map(match => [match.startFrame, match.endFrame]), [[4800, 6720], [24_000, 25_920]]);
	assert.equal(controller.project?.tracks.filter(track => track.type === 'label').length, 1);
	assert.deepEqual(controller.getSnapshot().lastAnalysisRequest, { type: 'repeated-sound', options: { similarityThreshold: .98 } });
	await controller.actions.analysis.repeatLast();
	assert.equal(controller.project?.tracks.filter(track => track.type === 'label').length, 2);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks.filter(track => track.type === 'label').length, 1);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks.filter(track => track.type === 'label').length, 0);
	assert.equal(controller.project?.clips[0]?.durationFrames, source.frameCount);
	controller.actions.edit.redo();
	assert.equal(controller.project?.tracks.filter(track => track.type === 'label').length, 1);
});
