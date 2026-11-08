/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { applyAudacityTruncateSilence } from '../src/common/editor/audacity-effects/basic.js';
import { assertAudacityEffectOutput } from '../src/common/editor/audacity-effects/pcm-channel-validation.ts';
import { normalizeAudacityEffectParams } from '../src/common/editor/audacity-effects/manifest.js';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../src/common/editor/effects.js';
import { bufferFromChannels } from '../src/common/editor/controller/source/source-audio.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';

test('previewing Truncate Silence after it removes the whole selected silence completes without an empty audio error', async () => {
	const sampleRate = 8000;
	let starts = 0;
	let published = 0;
	let status = '';
	const state = { audacityEffectType: 'audacity-truncate-silence', audacityEffectProcessing: false,
		audacityPreviewGeneration: 0, audacityPreviewSource: null,
		audacityEffectTouchedParams: new Map<string, Set<string>>() };
	const preview = createSelectionEffectPreviewService({ state, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 16 * 1024 ** 2,
		abortError: () => new DOMException('cancelled', 'AbortError'), assertAudacityEffectOutput,
		audacityEffectMemoryError: () => new Error('memory limit'),
		audacityEffectTargets: () => [{ track: { id: 'track' }, clipId: 'silent', clipIds: ['silent'],
			startFrame: 0, endFrame: sampleRate, durationFrames: sampleRate, channelCount: 1 }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: (channels: Float32Array[], rate: number) => bufferFromChannels(channels, rate, null, { decodedAudioEmpty: 'Decoded audio is empty',
			decodedChannelLengthsMismatch: 'Channel lengths differ', audacityProjectTooLong: 'Audio is too long', audioBufferUnsupported: 'Audio buffer unavailable' }),
		cancelAudacityEffectPreview() { state.audacityPreviewGeneration += 1; },
		copy: { audacityPreviewProcessing: 'Preparing', audacityPreviewPlaying: 'Playing', ready: 'Ready' },
		currentAudacityEffectParams: () => ({ thresholdDb: -20, action: 'truncate', minimumSilence: 0.5, truncateTo: 0, independent: false }),
		engine: { pause() {}, getPlaybackDestination: () => ({}), async getAudioContext() { return {
			createBufferSource: () => ({ buffer: null, onended: null, connect() {}, start() { starts += 1; } }),
		}; } },
		estimateAudioSelectionEffectPeakBytes: () => 0,
		getProject: () => ({ id: 'project' }), projectDurationFrames: () => sampleRate, projectSampleRate: () => sampleRate,
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams: normalizeAudacityEffectParams,
		publishDocumentSnapshot() { published += 1; },
		renderDryTrackRange: async () => [new Float32Array(sampleRate)],
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: async (request: { channels: Float32Array[]; sampleRate: number; params: Readonly<Record<string, unknown>> }) => ({
			channels: applyAudacityTruncateSilence(request.channels, request.sampleRate, request.params),
		}), setStatus(message: string) { status = message; },
	});
	assert.equal(await preview(), true);
	assert.equal(starts, 0);
	assert.equal(status, 'Ready');
	assert.equal(state.audacityEffectProcessing, false);
	assert.equal(state.audacityPreviewSource, null);
	assert.equal(published, 2);
});
