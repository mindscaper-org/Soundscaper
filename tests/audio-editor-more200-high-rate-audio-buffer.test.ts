/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioGeneratorService } from '../src/common/editor/controller/edit/generator-service.ts';
import { createSourceLifecycleService, type SourceLifecycleProject, type SourceLifecycleServiceRuntime } from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import { createFixture, project } from './helpers/audio-editor-generator-service-fixture.ts';

const unsupportedBuffer = () => new DOMException('Sample rate is not in the supported range.', 'NotSupportedError');
const pcm = Float32Array.of(0, 0.25, -0.5, 0.75);
const peaks = { levels: [1] };

for (const streamed of [false, true]) test(`768 kHz generation persists PCM when the optional native cache is unsupported; streamed=${streamed}`, async () => {
	const fixture = generationFixture(streamed);
	const result = await createAudioGeneratorService(fixture.dependencies).generateSignal('tone', { durationSeconds: 4 / 768_000 });
	assert.equal(typeof result, 'string');
	assert.deepEqual(fixture.writes, [[pcm]]);
	assert.equal(fixture.durableCommits(), 1);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 1);
	assert.equal(fixture.state.audacityEffectProcessing, false);
	assert.equal(fixture.closes(), streamed ? 1 : 0);
});

for (const failure of [new RangeError('Allocation failed'), new DOMException('Quota exhausted', 'QuotaExceededError')]) {
	test(`generation preserves ${failure.name} instead of publishing an unallocated source`, async () => {
		const fixture = generationFixture(true, failure);
		await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateSignal('tone'), error => error === failure);
		assert.equal(fixture.writes.length, 0);
		assert.equal(fixture.commits.length, 0);
		assert.equal(fixture.closes(), 1);
	});
}

test('a canceled unsupported native allocation cannot publish generated PCM', async () => {
	const fixture = generationFixture(true);
	const controller = new AbortController();
	fixture.dependencies.createEmptyBuffer = async () => { controller.abort(); throw unsupportedBuffer(); };
	await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateSignal('tone', { signal: controller.signal }), { name: 'AbortError' });
	assert.equal(fixture.writes.length, 0);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.closes(), 1);
});

test('a storage failure still rolls back generated PCM after native cache refusal', async () => {
	const fixture = generationFixture(false);
	const failure = new DOMException('Storage full', 'QuotaExceededError');
	fixture.writer.write = async () => { throw failure; };
	await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateSignal('tone'), error => error === failure);
	assert.equal(fixture.commits.length, 0);
	assert.deepEqual(fixture.deletedSources, ['generator-1']);
});

for (const operation of ['activate', 'reopen'] as const) test(`${operation} keeps a valid short stored source playable without a native buffer`, async () => {
	const fixture = activationFixture(unsupportedBuffer());
	if (operation === 'activate') await fixture.service.activateStoredSource(fixture.source, fixture.source);
	else await fixture.service.loadProjectSources(fixture.project);
	assert.equal(fixture.sourceChunkProviders.has(fixture.source.id), true);
	assert.equal(fixture.cachedBuffers.size, 0);
	assert.equal(fixture.missingSourceIds.size, 0);
	assert.equal(fixture.sourcePeaks.get(fixture.source.id), peaks);
	assert.deepEqual(fixture.storedPeakReads, [fixture.source.id]);
});

test('stored activation requires a valid chunk provider before ignoring a native capability error', async () => {
	const fixture = activationFixture(unsupportedBuffer(), false);
	await assert.rejects(fixture.service.activateStoredSource(fixture.source, fixture.source), { name: 'NotSupportedError' });
	assert.equal(fixture.sourcePeaks.size, 0);
});

test('stored activation preserves allocation failures even with a valid provider', async () => {
	const failure = new RangeError('Allocation failed');
	const fixture = activationFixture(failure);
	await assert.rejects(fixture.service.activateStoredSource(fixture.source, fixture.source), error => error === failure);
	await fixture.service.loadProjectSources(fixture.project);
	assert.deepEqual([...fixture.missingSourceIds], [fixture.source.id]);
	assert.equal(fixture.storedPeakReads.length, 0);
});

test('stored activation checks cancellation after the rejected optional native cache', async () => {
	const controller = new AbortController();
	const fixture = activationFixture(unsupportedBuffer(), true, () => controller.abort());
	await assert.rejects(fixture.service.activateStoredSource(fixture.source, fixture.source, { signal: controller.signal }), { name: 'AbortError' });
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.storedPeakReads.length, 0);
});

function generationFixture(streamed: boolean, failure: Error = unsupportedBuffer()) {
	const writes: Float32Array[][] = [];
	let durableCommits = 0;
	let closes = 0;
	const active = { ...project(), sampleRate: 768_000 };
	const fixture = createFixture({
		getProject: () => active,
		generateChannels: async () => ({ channelCount: 1, frameCount: pcm.length, channels: [pcm] }),
		...(streamed ? { generateStream: async () => ({
			type: 'tone', sampleRate: 768_000, channelCount: 1, frameCount: pcm.length,
			async *chunks() { yield [pcm]; },
			finish: async () => ({ version: 1, channelCount: 1, levels: [] }),
			close() { closes++; },
		}) } : {}),
		createBuffer: async () => { throw failure; },
		createEmptyBuffer: async () => { throw failure; },
	});
	const writer = {
		write: async (channels: Float32Array[]) => { writes.push(channels); },
		commit: async () => { durableCommits++; },
		abort: async () => undefined,
	};
	fixture.dependencies.store.beginSourceWrite = async () => writer;
	return { ...fixture, writer, writes, durableCommits: () => durableCommits, closes: () => closes };
}

function activationFixture(failure: Error, validProvider = true, beforeFailure: () => void = () => undefined) {
	const source = { id: 'high-rate', storageKey: 'high-rate', kind: 'audio', sampleRate: 768_000, channelCount: 1, frameCount: 4 };
	const active: SourceLifecycleProject = { id: 'high-rate-project', sources: [source], clips: [{ id: 'clip', sourceId: source.id }] };
	const cachedBuffers = new Map<string, AudioBufferLike>();
	const sourceChunkProviders = new Map<string, string>();
	const sourcePeaks = new Map<string, typeof peaks>();
	const missingSourceIds = new Set<string>();
	const storedPeakReads: string[] = [];
	const runtime: SourceLifecycleServiceRuntime<AudioBufferLike, SourceLifecycleProject, string, typeof peaks, typeof source> = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1024, activateVideoSource: async () => undefined,
		allProjectClips: value => value.clips, audioBufferChannels: value => [value.getChannelData(0)],
		clipSourceWindowRange: (_clip, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(), clipWaveformPcmWindows: new Map(), copy: {},
		createStoredChunkProviderCandidate: () => validProvider ? 'playable-provider' : null,
		engine: { getAudioContext: async () => ({}) },
		findClip: (value, id) => value.clips.find(clip => clip.id === id),
		findSource: (value, id) => value.sources.find(candidate => candidate.id === id),
		generateStoredWaveformPeaks: async (_store, value) => { storedPeakReads.push(value.id); return peaks; },
		generateWaveformPeaks: async () => { throw new Error('Unexpected native buffer'); },
		getProject: () => active, legacyPeakCacheKey: id => `old:${id}`, peakCacheKey: id => id,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async () => { beforeFailure(); throw failure; },
		readWaveformPcmWindow: async () => [pcm], setStatus: () => undefined,
		sourceAudioBufferBytes: () => 16,
		sourceBuffers: Object.assign(cachedBuffers, { setIfFits(id: string, buffer: AudioBufferLike) { cachedBuffers.set(id, buffer); return true; } }),
		sourceChunkProviders, sourcePcmBytes: () => 16, sourcePeaks, state: { missingSourceIds },
		store: { getSourceMetadata: async () => source, loadAnalysis: async () => null, saveAnalysis: async () => undefined, deleteAnalysis: async () => undefined },
		waveformPcmWindowContains: () => false, waveformPeaksHaveRms: value => value === peaks,
	};
	return { service: createSourceLifecycleService(runtime), source, project: active, cachedBuffers, sourceChunkProviders, sourcePeaks, missingSourceIds, storedPeakReads };
}
