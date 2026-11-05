/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { silentSelectedLaneFixture } from './helpers/silent-selected-lane-fixture.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import type { SelectionEffectResult } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import type { SelectionEffectWorkerRequest } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectOutputFrames, estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';

for (const duration of ['keep', 'extend'] as const) test(`Delay ${duration} admits selected silent lanes only for time insertion`, async () => {
	const { rate, project, lifetime, generation, state, copy, selection } = silentSelectedLaneFixture();
	let processed: readonly SelectionEffectResult[] = [];
	const service = createSelectionEffectExecutionService({ lifetime, state, copy,
		captureProject: () => generation.capture(), assertProject: (token: Parameters<typeof generation.assertCurrent>[0]) => generation.assertCurrent(token),
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 16 * 1024 ** 2, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		getProject: () => project, activeSelection: () => project.selection, editingBlocked: () => false,
		audacityEffectTargets: selection.audacityEffectTargets, audacitySpectralEffectContext: () => null,
		audacityEffectSelectionDetails: selection.audacityEffectSelectionDetails, projectSampleRate: () => rate, projectDurationFrames: () => 4 * rate,
		estimateAudioSelectionEffectPeakBytes, estimateAudioSelectionEffectOutputFrames,
		audacityEffectMemoryError: () => new Error('Too large'),
		currentAudacityEffectParams: () => ({ time: 1, echoes: 1, echoGain: 0, pitchShift: 0, mix: 1, duration }),
		normalizeAudioSelectionEffectParams, renderDryTrackRange: async (id: string) => [new Float32Array(rate).fill(id === 'first' ? 0.25 : 0)],
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		publishDocumentSnapshot() {}, setStatus() {}, preflightStorage: async () => undefined,
		runSelectionEffectWorker: async (request: SelectionEffectWorkerRequest) => ({ channels: await applyAudioSelectionEffectAsync(
			request.effectType, request.channels, request.sampleRate, request.params, request.context) }),
		persistAudacityEffectResults: async (results: readonly SelectionEffectResult[]) => { processed = results; },
	});
	try {
		await service.applySelectedAudacityEffect();
		assert.deepEqual(processed.map(result => result.target.track.id), duration === 'extend' ? ['first', 'later'] : ['first']);
		assert.deepEqual(processed.map(result => result.channels[0]!.length), duration === 'extend' ? [2 * rate, 2 * rate] : [rate]);
	} finally { lifetime.beginDisposal(); lifetime.finishDisposal(); }
});
