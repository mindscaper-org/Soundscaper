/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffectAsync } from '../src/common/editor/audacity-effects/index.js';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { defaultMixerChannelMapV21 } from '../src/common/editor/mixer-graph-v21.ts';

for (const wider of [2, 6]) test(`Amplify Preview mixes a mono selection into a ${wider}-channel target using the normal mono route`, async () => {
	const params = { gainDb: 0, allowClipping: true };
	let output: Float32Array[] = [];
	const preview = createSelectionEffectPreviewService({
		state: { audacityEffectType: 'audacity-amplify', audacityEffectProcessing: false, audacityPreviewGeneration: 0,
			audacityEffectTouchedParams: new Map([['audacity-amplify', new Set(['gainDb'])]]) },
		AUDIO_SELECTION_EFFECT_DEFINITIONS, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000,
		abortError: () => new DOMException('Cancelled', 'AbortError'), audacityEffectMemoryError: () => new Error('Too large'),
		assertAudacityEffectOutput() {}, audacityEffectTargets: () => [1, wider].map((width, index) => ({
			track: { id: String(index) }, startFrame: 0, endFrame: 480, durationFrames: 480, channelCount: width, clipIds: [String(index)],
		})), audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { output = channels; return {}; },
		cancelAudacityEffectPreview() {}, copy: {}, currentAudacityEffectParams: () => params,
		engine: { pause() {}, getPlaybackDestination: () => ({}), getAudioContext: async () => ({
			createBufferSource: () => ({ buffer: null, connect() {}, start() {} }),
		}) }, estimateAudioSelectionEffectPeakBytes: () => 0, getProject: () => ({}),
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams, projectDurationFrames: () => 480,
		projectSampleRate: () => 48_000, publishDocumentSnapshot() {}, setStatus() {},
		renderDryTrackRange: async (track: string) => Array.from({ length: track === '0' ? 1 : wider }, () => new Float32Array(480).fill(track === '0' ? .25 : 0)),
		resolveInteractiveAudacityParams: (_type: string, options: unknown) => options,
		runSelectionEffectWorker: async (request: { effectType: string; channels: Float32Array[]; sampleRate: number; params: typeof params }) => ({
			channels: await applyAudacityEffectAsync(request.effectType, request.channels, request.sampleRate, request.params),
		}),
	});
	assert.equal(await preview(), true);
	assert.equal(output.length, wider);
	const route = defaultMixerChannelMapV21(1, wider);
	assert.deepEqual(output.map(channel => channel[240]), route.map(source => source === 0 ? .25 : 0),
		'a mono track must not acquire centre, LFE or surround signal merely because another selected track is wider');
});
