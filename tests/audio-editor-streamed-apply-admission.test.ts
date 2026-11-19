/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import type { StreamedEffectPlan } from '../src/common/editor/controller/effects/internal/streamed/streamed-effect-service.ts';

for (const frames of [140003, 129600000]) for (const scope of ['range', 'clip', 'source'] as const) test(`ordinary ${scope} Apply chooses streaming at ${frames} frames before buffered memory admission`, async () => {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('project');
	const state = { audacityEffectType: 'audacity-normalize', audacityEffectProcessing: false, lastAudacityEffect: null };
	const calls: (readonly StreamedEffectPlan[])[] = [];
	const target = { track: { id: 'track', name: 'Track', type: 'audio' }, startFrame: 17, endFrame: 17 + frames, durationFrames: frames,
		channelCount: 2, hasAudio: true, ...(scope === 'source' ? { sourceId: 'original', sourceFrameCount: frames + 40, sourceSampleRate: 48000 } : {}),
		...(scope === 'clip' ? { clipId: 'clip' } : {}) };
	const service = createSelectionEffectExecutionService({ lifetime, state, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 256 * 1024 ** 2,
		captureProject: () => generation.capture(), assertProject: generation.assertCurrent.bind(generation),
		activeSelection: () => null, editingBlocked: () => false, audacityEffectTargets: () => [target],
		currentAudacityEffectParams: () => ({}), normalizeAudioSelectionEffectParams,
		audacitySpectralEffectContext: () => null, audacityEffectSelectionDetails: () => ({}), projectSampleRate: () => 48000,
		estimateAudioSelectionEffectOutputFrames: () => frames, estimateAudioSelectionEffectPeakBytes: () => 8 * 1024 ** 3,
		audacityEffectMemoryError: () => new Error('buffered memory refusal'), copy: { audacityProcessing: 'Processing', audacityApplied: 'Applied' },
		audioSelectionEffectLabel: () => 'Normalize', preflightStorage: async () => undefined, publishDocumentSnapshot: () => undefined, setStatus: () => undefined,
		runStreamedEffects: async (plans, options) => { options.assertCurrent(); calls.push(plans); },
		renderDryTrackRange: async () => { throw new Error('Buffered PCM must not be rendered.'); },
	});
	await service.applySelectedAudacityEffect();
	assert.equal(calls.length, 1); assert.equal(calls[0]![0]!.target.durationFrames, frames); assert.equal(state.audacityEffectProcessing, false);
	assert.ok(state.lastAudacityEffect); lifetime.beginDisposal(); lifetime.finishDisposal();
});
