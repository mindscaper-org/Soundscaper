/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('File Open never publishes the outgoing Contrast report under the incoming project identity', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'next-analysis-publication' });
	const source = createAudioSource({ id: 'source', frameCount: 4_800, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write([new Float32Array(4_800).fill(0.25)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'outgoing', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4_800, sourceDurationFrames: 4_800 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 4_800);
	await controller.actions.analysis.contrast('foreground', 'master');
	assert.ok(controller.getSnapshot().analysisReport);
	const publications: unknown[] = [];
	const unsubscribe = controller.subscribe(() => {
		const snapshot = controller.getSnapshot();
		if (snapshot.project?.id === 'incoming') publications.push(snapshot.analysisReport);
	});
	context.after(unsubscribe);
	await controller.actions.project.open(createSoundscaperProject({ id: 'incoming' }));
	assert.ok(publications.length > 0);
	assert.ok(publications.every(report => report === null), 'every new-project publication already owns clean analysis state');
});
