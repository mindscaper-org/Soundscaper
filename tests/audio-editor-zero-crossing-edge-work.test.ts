/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { findNearestAudioZeroCrossing } from '../src/common/editor/zero-crossing.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { audioBuffer, COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

test('the zero-crossing action renders only dry edge neighborhoods with exact full-range results', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createMemoryStore();
	const samples = Float32Array.from({ length: 200_000 }, (_, frame) => (frame % 123 < 60 ? 0.25 : -0.25));
	store.audioSources.set('source', [samples]);
	const project = createSoundscaperProject({ sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: samples.length }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: samples.length, sourceDurationFrames: samples.length }],
		tracks: [{ id: 'track', clipIds: ['clip'], effects: [], effectsActive: false }] });
	const ranges: Array<{ startFrame: number; endFrame: number }> = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: (_project: unknown, range: { startFrame: number; endFrame: number }) => {
			ranges.push(range); return Promise.resolve(audioBuffer([samples.slice(range.startFrame, range.endFrame)], 48_000));
		},
	} as unknown as Options);
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	controller.actions.timeline.setExactSelection(1_000, 199_000, { trackIds: ['track'] });
	await controller.actions.timeline.zeroCross();
	assert.equal(ranges.length, 2);
	assert.ok(ranges.reduce((frames, range) => frames + range.endFrame - range.startFrame, 0) <= 1_924);
	const original = samples.slice(520, 199_480);
	assert.equal(controller.project?.selection.startFrame, 520 + findNearestAudioZeroCrossing([original], 480, { maximumDistance: 480 }));
	assert.equal(controller.project?.selection.endFrame, 520 + findNearestAudioZeroCrossing([original], 198_480, { maximumDistance: 480 }));
});
