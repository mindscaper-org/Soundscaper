/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroService } from '../src/common/editor/controller/effects/internal/macro/effect-macro-service.ts';
import type { SelectionEffectResult } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import { silentSelectedLaneFixture } from './helpers/silent-selected-lane-fixture.ts';

test('a Repeat macro retains selected silent lanes so later audio receives the same inserted time', async () => {
	const { rate, project, lifetime, generation, selection } = silentSelectedLaneFixture();
	let processed: readonly SelectionEffectResult[] = [];
	const unavailable = (): never => { throw new Error('Offline Repeat does not require a realtime rack.'); };
	const service = createEffectMacroService<{ channels: readonly Float32Array[] }>({
		lifetime, projectGeneration: generation, memoryLimitBytes: 32 * 1024 ** 2,
		copy: { audioTrackNotFound: 'Missing', audacityApplied: 'Applied', audacityProcessing: 'Processing',
			audacitySelectionHint: 'Select audio', autoDuckControlTrack: 'Select control', effectInvalidAudio: 'Invalid',
			effectRackEmpty: 'Empty', noiseProfileMissing: 'Profile required', macrosPalette: 'Macro', untitledMacro: 'Macro' },
		getProject: () => project, audacityEffectTarget: selection.audacityEffectTarget,
		audacityEffectTargets: selection.audacityEffectTargets, editingBlocked: () => false,
		materializeRackEffect: unavailable, projectSampleRate: () => rate, effectRackLatencyFrames: () => 0,
		isAudacityRackEffectType: () => false, estimateAudacityEffectPeakBytes: () => 0,
		audacityEffectMemoryError: () => new Error('Too large'), setProcessing() {}, setStatus() {}, publishDocumentSnapshot() {},
		preflightStorage: async () => undefined, cloneProject: value => structuredClone(value),
		renderSnapshot: unavailable, renderStagedSnapshot: unavailable, projectFrameCount: () => 4 * rate,
		renderDryTrackRange: async (id, start, end) => [new Float32Array(end - start).fill(id === 'first' ? .25 : 0)],
		runSelectionEffectWorker: async request => {
			assert.equal(request.effectType, 'audacity-repeat');
			return { channels: request.channels.map(channel => {
				const repeated = new Float32Array(channel.length * 2); repeated.set(channel); repeated.set(channel, channel.length); return repeated;
			}) };
		},
		createAudioBuffer: unavailable, audioBufferChannels: value => value.channels,
		matchAudacitySelectionChannels: channels => [...channels], persistAudacityEffectResult: async (target, _type, channels) => { processed = [{ target, channels }]; },
		persistAudacityEffectResults: async results => { processed = results; }, handleError: error => { throw error; },
	});
	try {
		await service.runEffectMacro({ name: 'Repeat selection', effects: [{ id: 'repeat', type: 'audacity-repeat', params: { count: 1 } }] });
		assert.deepEqual(processed.map(result => result.target.track.id), ['first', 'later']);
		assert.deepEqual(processed.map(result => result.channels[0]!.length), [rate * 2, rate * 2]);
	} finally { lifetime.beginDisposal(); lifetime.finishDisposal(); }
});
