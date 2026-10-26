/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { audioBuffer, COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

test('NP006: retired zero-crossing cleanup cannot clear a newer Levels analysis after switching tabs back', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createMemoryStore();
	store.audioSources.set('source', [new Float32Array(4096).fill(.25)]);
	const original = createSoundscaperProject({ id: 'first', sources: [createAudioSource({ id: 'source', frameCount: 4096, channelCount: 1 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })], clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 4096, sourceDurationFrames: 4096 })] });
	const requests: Array<() => void> = [];
	let changed: (() => void) | null = null;
	const options = { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: (_project: unknown, range: { startFrame: number; endFrame: number }) => new Promise<ReturnType<typeof audioBuffer>>(resolve => {
			requests.push(() => resolve(audioBuffer([new Float32Array(range.endFrame - range.startFrame).fill(.25)], 48_000)));
			changed?.();
		}) };
	const controller = createAudioEditorController(null, options as unknown as Options);
	context.after(async () => { requests.forEach(resolve => resolve()); await controller.dispose(); });
	await controller.ready; await store.saveProject(original); await controller.actions.project.open(original);
	controller.actions.timeline.setSelection(512, 3072, { trackIds: ['voice'] });
	const retired = controller.actions.timeline.zeroCross();
	await waitForRequests(1);
	await controller.actions.project.create({ title: 'Other' });
	await controller.actions.project.openById('first');
	const current = controller.actions.analysis.run('master');
	await waitForRequests(2);
	assert.equal(controller.getSnapshot().analysisProcessing, true);
	requests[0]!(); await retired;
	assert.equal(controller.getSnapshot().analysisProcessing, true, 'the newer Analyze Levels request still owns busy state');
	requests[1]!(); await current;
	assert.equal(controller.getSnapshot().analysisProcessing, false);

	async function waitForRequests(count: number) {
		while (requests.length < count) await new Promise<void>(resolve => { changed = resolve; });
		changed = null;
	}
});
