/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioAnalysisService, type AnalysisDependencies } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('specialized modal reports publish and cache without running unused levels analysis', async () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 2_048 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 2_048, sourceDurationFrames: 2_048 });
	const project = createSoundscaperProject({ id: 'analysis', sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const channels = [Float32Array.from({ length: 2_048 }, (_, frame) => Math.sin(frame / 20))];
	let levels = 0; let specialized = 0;
	const shown: unknown[] = [];
	const dependencies: AnalysisDependencies = {
		lifetime, state: {}, copy: ENGLISH_COPY,
		captureProject: () => generation.capture(project.id), assertProject: token => generation.assertCurrent(token),
		getProject: () => project, getSelectedTrackId: () => 'track', getRange: () => ({ startFrame: 0, endFrame: 2_048 }),
		getActiveSelection: () => null, getSpectrumWindowSize: () => 2_048,
		getContrastSelections: () => ({ foreground: null, background: null }), setContrastSelections() {},
		loadAnalysis: async () => null, saveAnalysis: async () => undefined,
		renderAudio: async () => ({ sampleRate: 48_000, numberOfChannels: 1, length: 2_048, getChannelData: index => channels[index]! }),
		analyzeChannels: async () => { levels += 1; return { peak: 1 }; }, createVisuals: () => null,
		createSpecializedReport: async (type) => { specialized += 1; return { type, complete: true }; },
		showAnalysis(result, _visuals, report) { shown.push({ result, report }); },
		setProcessing() {}, setStatus() {}, publish() {}, handleError(error) { throw error; },
	};
	const service = createAudioAnalysisService(dependencies);
	assert.deepEqual(await service.plotSpectrum(), { type: 'spectrum', complete: true });
	assert.deepEqual(await service.repeatLast(), { type: 'spectrum', complete: true });
	assert.deepEqual(await service.findClipping(), { type: 'clipping', complete: true });
	assert.equal(specialized, 2);
	assert.equal(levels, 0);
	assert.ok(shown.every((value) => (value as { result: unknown }).result === null));
	assert.ok(await service.run());
	assert.equal(levels, 1, 'the requested levels workflow still measures levels');
});
