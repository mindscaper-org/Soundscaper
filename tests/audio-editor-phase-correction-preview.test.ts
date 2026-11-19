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
import { phaseCorrectionPreviewReports } from '../src/common/editor/first-party-effects/phase-correction/preview-contract.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

function fixture(cancelAfterRender = false) {
	const rate = 8000, frames = rate * 8;
	let seed = 19;
	const left = Float32Array.from({ length: frames }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		return seed / 2 ** 33;
	});
	const right = left.map((_, frame) => left[frame - 12] ?? 0);
	const state = { audacityEffectType: 'automatic-phase-correction', audacityEffectProcessing: false,
		audacityPreviewGeneration: 0, audacityPreviewSource: null as unknown,
		audacityEffectTouchedParams: new Map<string, Set<string>>() };
	const renders: number[] = [], jobs: SelectionEffectWorkerRequest[] = [], played: Float32Array[][] = [];
	const worker = createSelectionEffectWorkerService({
		state: { audacityEffectWorker: null, spectralWorker: null }, copy: ENGLISH_COPY,
		captureProject: () => ({ projectId: 'project', generation: 0 }), assertProject() {},
		workerAvailable: () => false, loadParametricEqWasmModule: async () => null, initializePffft: async () => null,
		captureNoiseProfile: () => null, applySpectralGain: channels => channels,
		applySelectionEffect: applyAudioSelectionEffectAsync,
	});
	const preview = createSelectionEffectPreviewService({
		state, AUDIO_SELECTION_EFFECT_DEFINITIONS, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 256 * 1024 ** 2,
		abortError: () => new DOMException('cancelled', 'AbortError'), assertAudacityEffectOutput,
		audacityEffectMemoryError: () => new Error('memory limit'),
		audacityEffectTargets: () => [{ track: { id: 'track', name: 'Stereo recording' }, startFrame: 0,
			endFrame: frames, durationFrames: frames, channelCount: 2 }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { played.push(channels); return { channels }; },
		cancelAudacityEffectPreview() { state.audacityPreviewGeneration++; }, copy: ENGLISH_COPY,
		currentAudacityEffectParams: () => ({}),
		engine: { pause() {}, getPlaybackDestination: () => ({}), async getAudioContext() {
			return { createBufferSource: () => ({ buffer: null, onended: null, connect() {}, start() {} }) };
		} },
		estimateAudioSelectionEffectPeakBytes, getProject: () => ({ id: 'project' }),
		projectDurationFrames: () => frames, projectSampleRate: () => rate,
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams,
		publishDocumentSnapshot() {},
		renderDryTrackRange: async (_track: string, start: number, end: number) => {
			renders.push(end - start);
			if (cancelAfterRender) state.audacityPreviewGeneration++;
			return [left.slice(start, end), right.slice(start, end)];
		},
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: (request: SelectionEffectWorkerRequest) => { jobs.push(request); return worker.runSelectionEffectWorker(request); },
		setStatus() {},
	});
	return { preview, state, renders, jobs, played, left, right, rate, frames };
}

test('Analyze uses the whole selection, returns the worker report, and leaves playback and PCM untouched', async () => {
	const f = fixture();
	const reports = phaseCorrectionPreviewReports(await f.preview({ phaseCorrection: { analyzeOnly: true } }));
	assert.deepEqual(f.renders, [f.frames]);
	assert.equal(reports?.[0]?.analysis.lagSamples, 12);
	assert.equal(reports?.[0]?.trackName, 'Stereo recording');
	assert.equal(f.jobs[0]?.context?.phaseCorrectionAnalyzeOnly, true);
	assert.deepEqual(f.played, []);
	assert.equal(f.state.audacityPreviewSource, null);
	assert.equal(f.state.audacityEffectProcessing, false);
});

test('corrected preview shares the full-selection analysis and trims playback to six seconds', async () => {
	const f = fixture();
	const reports = phaseCorrectionPreviewReports(await f.preview());
	assert.equal(reports?.[0]?.analysis.lagSamples, 12);
	assert.deepEqual(f.renders, [f.frames]);
	assert.equal(f.played[0]?.[0]?.length, f.rate * 6);
	assert.deepEqual(f.played[0]?.[0], f.left.slice(0, f.rate * 6));
	assert.deepEqual(f.played[0]?.[1]?.slice(128, -128), f.left.slice(128, f.rate * 6 - 128));
});

test('original and mono audition settings do not enter the effect parameters or change applied PCM', async () => {
	const f = fixture();
	await f.preview({ phaseCorrection: { source: 'original', mono: true } });
	assert.equal(f.jobs.length, 0);
	const expected = f.left.slice(0, f.rate * 6).map((sample, frame) => (sample + f.right[frame]!) / 2);
	assert.deepEqual(f.played[0]?.[0], expected);
	assert.deepEqual(f.played[0]?.[1], expected);
	await f.preview({ phaseCorrection: { source: 'corrected', mono: true } });
	assert.deepEqual(f.jobs[0]?.params, { reference: 'left', maximumShiftMs: 5, minimumConfidence: 85 });
	assert.deepEqual(f.played[1]?.[0], f.played[1]?.[1]);
	assert.deepEqual(f.right.slice(12), f.left.slice(0, -12));
});

test('cancelled analysis cannot launch a worker, play audio, or return a stale report', async () => {
	const f = fixture(true);
	assert.equal(await f.preview({ phaseCorrection: { analyzeOnly: true } }), false);
	assert.deepEqual(f.jobs, []);
	assert.deepEqual(f.played, []);
	assert.equal(f.state.audacityEffectProcessing, false);
});

test('worker context admits only the analysis flag and the report parser rejects malformed responses', () => {
	assert.equal(normalizeSelectionEffectWorkerContext({ phaseCorrectionAnalyzeOnly: true }).phaseCorrectionAnalyzeOnly, true);
	assert.deepEqual(normalizeSelectionEffectWorkerContext({ phaseCorrectionAnalyzeOnly: 'true', onPhaseCorrectionAnalysis() {} }), {});
	for (const response of [true, null, {}, { phaseCorrectionAnalysis: [] }, { phaseCorrectionAnalysis: [null] },
		{ phaseCorrectionAnalysis: [{ trackName: 'bad', sampleRate: 0, analysis: {} }] }]) {
		assert.equal(phaseCorrectionPreviewReports(response), null);
	}
});
