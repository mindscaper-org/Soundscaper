/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { createSelectionEffectWorkerService, type SelectionEffectWorkerRequest } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';
import { normalizeSelectionEffectWorkerContext } from '../src/common/editor/selection-effects-worker-context.ts';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { assertAudacityEffectOutput } from '../src/common/editor/audacity-effects/pcm-channel-validation.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { levelMatchEqPreview, matchEqPreviewReports } from '../src/common/editor/first-party-effects/match-eq/preview-contract.ts';
import { learnMatchEqProfile } from '../src/common/editor/first-party-effects/match-eq/analysis.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

function fixture(cancelAfterRender = false, targetCount = 1, staggerTargets = false) {
	const rate = 8000, frames = rate * 8;
	let seed = 19;
	const pcm = Float32Array.from({ length: frames }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		return seed / 2 ** 34;
	});
	let params: Readonly<Record<string, unknown>> = {};
	const state = { audacityEffectType: 'match-eq', audacityEffectProcessing: false,
		audacityPreviewGeneration: 0, audacityPreviewSource: null as unknown,
		audacityEffectTouchedParams: new Map<string, Set<string>>() };
	const renders: number[] = [], jobs: SelectionEffectWorkerRequest[] = [], played: Float32Array[][] = [];
	const processingModes: string[] = [];
	const worker = createSelectionEffectWorkerService({
		state: { audacityEffectWorker: null, spectralWorker: null }, copy: ENGLISH_COPY,
		captureProject: () => ({ projectId: 'project', generation: 0 }), assertProject() {},
		workerAvailable: () => false, loadParametricEqWasmModule: async () => null, initializePffft: async () => null,
		captureNoiseProfile: () => null, applySpectralGain: channels => channels, applySelectionEffect: applyAudioSelectionEffectAsync,
	});
	const preview = createSelectionEffectPreviewService({
		state, AUDIO_SELECTION_EFFECT_DEFINITIONS, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 256 * 1024 ** 2,
		abortError: () => new DOMException('cancelled', 'AbortError'), assertAudacityEffectOutput,
		audacityEffectMemoryError: () => new Error('memory limit'),
		audacityEffectTargets: () => Array.from({ length: targetCount }, (_, index) => ({ track: { id: `track-${String(index)}`, name: 'Voice' },
			startFrame: staggerTargets ? index * frames : 0, endFrame: frames + (staggerTargets ? index * frames : 0), durationFrames: frames, channelCount: 1 })),
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { played.push(channels); return { channels }; },
		cancelAudacityEffectPreview() { state.audacityPreviewGeneration++; }, copy: ENGLISH_COPY,
		currentAudacityEffectParams: () => params,
		engine: { pause() {}, getPlaybackDestination: () => ({}), async getAudioContext() {
			return { createBufferSource: () => ({ buffer: null, onended: null, connect() {}, start() {} }) };
		} },
		estimateAudioSelectionEffectPeakBytes, getProject: () => ({ id: 'project' }),
		projectDurationFrames: () => frames, projectSampleRate: () => rate,
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams, publishDocumentSnapshot() {},
		renderDryTrackRange: async (_track: string, start: number, end: number, _channels: number, _clips: unknown, _signal: unknown, processing = 'dry') => {
			renders.push(end - start);
			processingModes.push(processing);
			if (cancelAfterRender) state.audacityPreviewGeneration++;
			return [pcm.slice(start % frames, start % frames + end - start)];
		},
		resolveInteractiveAudacityParams: (_type: string, values: unknown) => values,
		runSelectionEffectWorker: (request: SelectionEffectWorkerRequest) => { jobs.push(request); return worker.runSelectionEffectWorker(request); },
		setStatus() {},
	});
	return { preview, state, renders, jobs, played, pcm, rate, frames, processingModes, setParams(value: typeof params) { params = value; } };
}

test('learning returns a whole-selection reference without playing or publishing audio', async () => {
	const f = fixture();
	const result = matchEqPreviewReports(await f.preview({ matchEq: { captureReference: true } }));
	assert.deepEqual(f.renders, [f.frames]);
	assert.deepEqual(f.processingModes, ['authored']);
	assert.deepEqual(result?.[0]?.analysis.profile, await learnMatchEqProfile([f.pcm], f.rate));
	assert.deepEqual(result?.[0]?.analysis.curve, []);
	assert.equal(f.played.length, 0);
	assert.equal(f.state.audacityEffectProcessing, false);
});

test('target analysis, original A/B, and corrected preview share full targets and six-second playback', async () => {
	const f = fixture();
	f.setParams({ reference: await learnMatchEqProfile([f.pcm], f.rate) });
	const result = matchEqPreviewReports(await f.preview({ matchEq: { analyzeOnly: true } }));
	assert.equal(result?.[0]?.analysis.curve.length, 128);
	assert.equal(f.played.length, 0);
	await f.preview({ matchEq: { source: 'original' } });
	assert.equal(f.jobs.length, 1);
	assert.deepEqual(f.played[0]?.[0], f.pcm.slice(0, f.rate * 6));
	await f.preview({ matchEq: { source: 'corrected' } });
	assert.deepEqual(f.renders, [f.frames, f.frames, f.frames]);
	assert.deepEqual(f.processingModes, ['dry', 'dry', 'dry']);
	assert.equal(f.played[1]?.[0]?.length, f.rate * 6);
	assert.equal('source' in f.jobs[1]!.params!, false);
	assert.equal(f.state.audacityEffectProcessing, false);
});

test('analysis includes disjoint targets beyond the six-second audition window', async () => {
	const f = fixture(false, 2, true);
	f.setParams({ reference: await learnMatchEqProfile([f.pcm], f.rate) });
	const reports = matchEqPreviewReports(await f.preview({ matchEq: { analyzeOnly: true } }));
	assert.equal(reports?.length, 2);
	assert.equal(f.jobs.length, 2);
	assert.equal(f.played.length, 0);
});

test('reference capture refuses multiple targets and cancelled renders cannot launch workers', async () => {
	const many = fixture(false, 2);
	await assert.rejects(many.preview({ matchEq: { captureReference: true } }), /one audio/i);
	assert.deepEqual(many.renders, []);
	const cancelled = fixture(true);
	assert.equal(await cancelled.preview({ matchEq: { captureReference: true } }), false);
	assert.deepEqual(cancelled.jobs, []);
	assert.deepEqual(cancelled.played, []);
});

test('preview compensation changes only temporary PCM and context/report admission rejects malformed values', () => {
	const input = [Float32Array.of(.1, -.2, .3)], output = [input[0]!.map(value => value * 2)];
	assert.deepEqual(levelMatchEqPreview(output, input, 3), input);
	assert.deepEqual(output[0], Float32Array.of(.2, -.4, .6));
	assert.deepEqual(normalizeSelectionEffectWorkerContext({ matchEqCaptureReference: true, matchEqAnalyzeOnly: 'true', onMatchEqAnalysis() {} }), { matchEqCaptureReference: true });
	for (const value of [true, null, {}, { matchEqAnalysis: [] }, { matchEqAnalysis: [{ trackName: 'bad', sampleRate: 0 }] }]) {
		assert.equal(matchEqPreviewReports(value), null);
	}
});
