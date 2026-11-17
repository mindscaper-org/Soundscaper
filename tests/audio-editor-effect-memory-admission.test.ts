/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectPeakMemoryLimitBytes } from '../src/common/editor/effect-memory-budget.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

for (const operation of ['prepare', 'preview', 'apply'] as const) test(`${operation} uses the current desktop memory preference without recreating the effect service`, async () => {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('project');
	const project = { id: 'project' }, reachedProcessing = new Error('reached processing'), tooLarge = new Error('memory limit');
	let desktop = false, configured = 4, estimated = 1024 ** 3;
	const state = { audacityEffectType: 'audacity-amplify', audacityEffectProcessing: false,
		audacityEffectTouchedParams: new Map(), audacityPreviewGeneration: 0 };
	const service = createSelectionEffectExecutionService({
		get AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES() { return effectPeakMemoryLimitBytes(desktop, configured); },
		lifetime, state, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		captureProject: () => generation.capture(), assertProject: generation.assertCurrent.bind(generation),
		getProject: () => project, activeSelection: () => null, editingBlocked: () => false,
		audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: 0, endFrame: 4, durationFrames: 4, channelCount: 1, hasAudio: true }],
		audacitySpectralEffectContext: () => null, audacityEffectSelectionDetails: () => ({}),
		projectSampleRate: () => 48_000, projectDurationFrames: () => 4,
		estimateAudioSelectionEffectPeakBytes: () => estimated, estimateAudioSelectionEffectOutputFrames: () => 4,
		copy: { audacityProcessing: 'Processing' }, audacityEffectMemoryError: () => tooLarge,
		currentAudacityEffectParams: () => ({ gainDb: 0 }), normalizeAudioSelectionEffectParams,
		setAudacityEffectType: (type: string) => { state.audacityEffectType = type; },
		cancelAudacityEffectPreview: () => undefined, publishDocumentSnapshot: () => undefined, setStatus: () => undefined,
		preflightStorage: async () => { throw reachedProcessing; }, renderDryTrackRange: async () => { throw reachedProcessing; },
	});
	const run = () => operation === 'prepare' ? service.prepareAudacityEffectFromController('audacity-amplify')
		: operation === 'preview' ? service.previewAudacityEffectFromController() : service.applySelectedAudacityEffect();
	await assert.rejects(run(), error => error === tooLarge);
	desktop = true;
	await assert.rejects(run(), error => error === reachedProcessing);
	estimated = 6 * 1024 ** 3;
	await assert.rejects(run(), error => error === tooLarge);
	configured = 8;
	await assert.rejects(run(), error => error === reachedProcessing);
});
