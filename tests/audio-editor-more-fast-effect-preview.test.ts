/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyAudacityEffectAsync } from '../src/common/editor/audacity-effects/index.js';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { normalizeSelectionEffectWorkerContext } from '../src/common/editor/selection-effects-worker-context.ts';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';

interface WorkerRequest {
	readonly effectType: string;
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly params: Readonly<Record<string, unknown>>;
	readonly context: unknown;
}

for (const [type, options, rate] of [
	['audacity-change-tempo', { tempoPercent: 100 }, 2],
	['audacity-change-speed-pitch', { speedPercent: 25 }, 1.25],
	['audacity-sliding-stretch', { startTempoPercent: 100, endTempoPercent: 100 }, 2],
	['audacity-change-tempo', { tempoPercent: -50 }, .5],
] as const) test(`${type} at ${rate} times speed retains a complete six-second output audition`, async () => {
	const sampleRate = 8_000;
	const frames = 18 * sampleRate;
	const input = Float32Array.from({ length: frames }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
	const staffPadRuntime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const params = normalizeAudioSelectionEffectParams(type, options);
	const complete = (await applyAudacityEffectAsync(type, [input], sampleRate, params, { staffPadRuntime }))[0]!;
	let played: Float32Array[] = [];
	let admittedFrames = 0;
	const renders: number[][] = [];
	const preview = createSelectionEffectPreviewService({
		state: { audacityEffectType: type, audacityEffectProcessing: false, audacityPreviewGeneration: 0,
			audacityEffectTouchedParams: new Map<string, Set<string>>(), audacityPreviewSource: null as unknown },
		AUDIO_SELECTION_EFFECT_DEFINITIONS, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 100_000_000,
		abortError: () => new DOMException('Cancelled', 'AbortError'), audacityEffectMemoryError: () => new Error('Too large'),
		assertAudacityEffectOutput: (channels: Float32Array[]) => assert.equal(channels.length, 1),
		audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: 0, endFrame: frames,
			durationFrames: frames, channelCount: 1, clipIds: ['clip'], sourceSampleRate: sampleRate }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: (channels: Float32Array[]) => { played = channels; return Promise.resolve({}); },
		cancelAudacityEffectPreview() {}, copy: {}, currentAudacityEffectParams: () => params,
		engine: { pause() {}, getPlaybackDestination: () => ({}), getAudioContext: () => Promise.resolve({
			createBufferSource: () => ({ buffer: null as unknown, onended: null as unknown, connect() {}, start() {} }) }) },
		estimateAudioSelectionEffectPeakBytes: (_type: string, count: number) => { admittedFrames = count; return 0; },
		getProject: () => ({}), mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => frames, projectSampleRate: () => sampleRate, publishDocumentSnapshot() {},
		renderDryTrackRange: (_track: string, start: number, end: number) => {
			renders.push([start, end]); return Promise.resolve([input.slice(start, end)]);
		},
		resolveInteractiveAudacityParams: (_type: string, value: unknown) => value,
		runSelectionEffectWorker: async (request: WorkerRequest) => ({ channels: await applyAudacityEffectAsync(
			request.effectType, request.channels, request.sampleRate, request.params,
			{ ...normalizeSelectionEffectWorkerContext(request.context), staffPadRuntime }) }),
		setStatus() {},
	});
	assert.equal(await preview(), true);
	assert.equal(played[0]!.length, 6 * sampleRate, 'the audition budget is measured at the output clock');
	assert.equal(admittedFrames, Math.round(6 * sampleRate * Math.max(1, rate)));
	assert.deepEqual(renders[0], [0, admittedFrames]);
	let residual = 0;
	for (let frame = sampleRate; frame < 3 * sampleRate; frame++) residual = Math.max(residual, Math.abs(played[0]![frame]! - complete[frame]!));
	assert.ok(residual < 1e-6, `preview and applied PCM differ by ${residual}`);
});
