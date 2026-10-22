/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectControlsService, type EffectControlsState, type EffectControlPreviewSource } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { deferred } from './helpers/async-test-control.ts';

function fixture(phase: 'render' | 'worker' | 'eq') {
	const entered = deferred<void>(); const renderGate = deferred<void>();
	const equalizerGate = deferred<EffectControlPreviewSource>();
	const workerGates: Array<ReturnType<typeof deferred<{ channels: Float32Array[] }>>> = [];
	const state: EffectControlsState & { audacityEffectProcessing: boolean } = {
		audacityEffectType: phase === 'eq' ? 'eq' : 'audacity-fade-in', audacityEffectParams: {}, audacityEffectTouchedParams: new Map(),
		audacityPreviewSource: null, audacityPreviewAuditionBandId: null, audacityPreviewGeneration: 0,
		audacityControlTrackId: null, effectPresets: { schemaVersion: 1, presets: [] }, lastAudacityEffect: null,
		audacityEffectProcessing: false,
	};
	const controls = createEffectControlsService({ state, copy: { ready: 'Ready', audacitySelectionHint: '',
		controlTrackNotFound: '', rackEffectNotFound: '', selectionEffectUnsupported: '' }, createId: () => 'id',
		getProject: () => ({ id: 'project', tracks: [], master: {} }), persistSetting: async () => undefined,
		publishDocumentSnapshot() {}, setStatus() {}, applySelectedAudacityEffect: async () => undefined,
		captureRackNoiseProfile() {},
	});
	let renders = 0; let cancellations = 0; let played = 0;
	const preview = createSelectionEffectPreviewService({ state, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000,
		abortError: () => new DOMException('Cancelled', 'AbortError'), audacityEffectMemoryError: () => new Error('Too large'),
		assertAudacityEffectOutput() {}, audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: 0,
			endFrame: 480, durationFrames: 480, channelCount: 1, clipIds: ['clip'], sourceSampleRate: 48_000 }],
		audacitySpectralEffectContext: () => null, bufferFromChannels: async () => ({}),
		cancelAudacityEffectPreview: controls.cancelAudacityEffectPreview, copy: {},
		currentAudacityEffectParams: controls.currentAudacityEffectParams,
		engine: { pause() {}, getPlaybackDestination: () => ({}), getAudioContext: async () => ({ createBufferSource: () => ({
			buffer: null, connect() {}, start() { played++; },
		}) }), createParametricEqPreview() { entered.resolve(); return equalizerGate.promise; } },
		estimateAudioSelectionEffectPeakBytes: () => 0, getProject: () => ({}),
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams, projectDurationFrames: () => 480,
		projectSampleRate: () => 48_000, publishDocumentSnapshot() {}, setStatus() {},
		renderDryTrackRange: async () => {
			if (++renders === 1 && phase === 'render') { entered.resolve(); await renderGate.promise; }
			return [new Float32Array(480).fill(.2)];
		}, resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: () => {
			const gate = deferred<{ channels: Float32Array[] }>(); workerGates.push(gate);
			entered.resolve(); return gate.promise;
		}, cancelSelectionWorkers: () => {
			cancellations++; workerGates.at(-1)?.reject(new DOMException('Cancelled worker', 'AbortError'));
		},
	});
	return { state, controls, preview, entered, renderGate, equalizerGate, workerGates, cancellations: () => cancellations, played: () => played };
}

test('Cancel during preview computation releases its worker and editor ownership immediately', async () => {
	const f = fixture('worker'); const pending = f.preview();
	await f.entered.promise;
	try {
		assert.equal(f.controls.cancelAudacityEffectPreview(), true);
		assert.equal(f.cancellations(), 1, 'Cancel must retire the active selection preview worker');
		assert.equal(f.state.audacityEffectProcessing, false, 'closing the dialog must leave editing available');
	} finally { for (const gate of f.workerGates) gate.resolve({ channels: [new Float32Array(480)] }); }
	assert.equal(await pending, false);
	assert.equal(f.played(), 0);
});

test('a canceled slow preview cannot clear a newer preview processing state', async () => {
	const f = fixture('render'); const old = f.preview();
	await f.entered.promise;
	try {
		f.controls.cancelAudacityEffectPreview();
		assert.equal(f.state.audacityEffectProcessing, false);
		const replacement = f.preview();
		for (let turn = 0; turn < 20 && !f.workerGates.length; turn++) await Promise.resolve();
		assert.equal(f.workerGates.length, 1);
		f.renderGate.resolve();
		assert.equal(await old, false);
		assert.equal(f.state.audacityEffectProcessing, true, 'the replacement still owns the busy state');
		f.controls.cancelAudacityEffectPreview();
		assert.equal(await replacement, false);
	} finally { f.renderGate.resolve(); for (const gate of f.workerGates) gate.resolve({ channels: [new Float32Array(480)] }); }
	await old;
});

test('equalizer preview retains cancellation ownership while its worklet graph is being prepared', async () => {
	const f = fixture('eq'); const pending = f.preview();
	await f.entered.promise;
	let stopped = 0;
	let outcome: unknown;
	try {
		assert.equal(f.state.audacityEffectProcessing, true);
		assert.equal(f.controls.cancelAudacityEffectPreview(), true);
	} finally {
		const graph = { onended: null, onerror: null, start() {}, stop() { stopped++; } };
		f.equalizerGate.resolve(graph);
		outcome = await pending;
	}
	assert.equal(outcome, false);
	assert.equal(stopped, 1, 'a late canceled graph is retired before it can start');
	assert.equal(f.state.audacityEffectProcessing, false);
});
