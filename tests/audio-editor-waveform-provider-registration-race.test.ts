/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaveformPcmWindowRequester } from '../src/common/editor/controller/source/internal/waveform-pcm-window-service.ts';
import { createSourceChunkProviderRegistration } from '../src/common/editor/controller/source/internal/source-chunk-provider-registration.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source/source-chunk-provider-registry.ts';
import { createStoredChunkProvider } from '../src/common/editor/controller/source/source-audio.ts';
import type { SourceLifecycleServiceRuntime } from '../src/common/editor/controller/source/source-lifecycle-service.ts';

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(complete => { resolve = complete; });
	return { promise, resolve };
}

function fixture(peak: boolean) {
	const source = { id: 'source', storageKey: 'source', kind: 'audio', frameCount: 1000, channelCount: 1, sampleRate: 48_000, chunkFrames: 1000 };
	const metadata = { id: source.id, frameLength: source.frameCount, channelCount: 1, sampleRate: 48_000, chunkFrames: 1000, chunkCount: 1 };
	const project = { id: 'project', sources: [source], clips: [
		{ id: 'first', sourceId: source.id, durationFrames: 1000, sourceDurationFrames: 1000 },
		{ id: 'second', sourceId: source.id, durationFrames: 1000, sourceDurationFrames: 1000 },
	] };
	const pcm = [new Float32Array(1000)];
	const storedMetadata = deferred<typeof metadata>();
	const lookupStarted = deferred<void>();
	const store = { readSourceChunk: () => pcm };
	type Provider = ReturnType<typeof createStoredChunkProvider>;
	const registry = new SourceChunkProviderRegistry<string, Provider>();
	const readProviders: Provider[] = [];
	let createdProviders = 0;
	const registration = createSourceChunkProviderRegistration({
		createStoredChunkProviderCandidate() { createdProviders += 1; return createStoredChunkProvider(store, source, metadata); },
		sourceChunkProviders: registry,
		engine: {},
	});
	const buffers = new Map<string, unknown>();
	const runtime: SourceLifecycleServiceRuntime<unknown, typeof project, Provider> = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 4, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: peak ? 16 : 1000,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1000, activateVideoSource: () => undefined,
		allProjectClips: value => value.clips, audioBufferChannels: () => [],
		clipSourceWindowRange: (_clip, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(), clipWaveformPcmWindows: new Map(), copy: {},
		createStoredChunkProviderCandidate: () => createStoredChunkProvider(store, source, metadata), engine: {},
		findClip: (value, id) => value.clips.find(clip => clip.id === id),
		findSource: (value, id) => value.sources.find(candidate => candidate.id === id),
		generateStoredWaveformPeaks: () => null, generateWaveformPeaks: () => null,
		getProject: () => project, legacyPeakCacheKey: id => id, peakCacheKey: id => id,
		publishDocumentSnapshot: () => undefined, readStoredAudioBuffer: () => null,
		readWaveformPcmWindow: async provider => {
			readProviders.push(provider);
			await provider.readStorageChunk(0);
			return pcm;
		},
		readWaveformPeakWindow: async (provider, range) => {
			readProviders.push(provider);
			await provider.readStorageChunk(0);
			return { ...range, blockSize: 16, pixelsPerSample: 1 / 16, channels: [] };
		},
		setStatus: () => undefined, sourceAudioBufferBytes: () => 0,
		sourceBuffers: { ...buffers, [Symbol.iterator]: () => buffers.entries(), has: id => buffers.has(id), get: id => buffers.get(id),
			delete: id => buffers.delete(id), setIfFits: (id, value) => { buffers.set(id, value); return true; } },
		sourceChunkProviders: registry, sourcePcmBytes: () => 4000, sourcePeaks: new Map(), state: { missingSourceIds: new Set() },
		store: { getSourceMetadata: () => { lookupStarted.resolve(); return storedMetadata.promise; },
			loadAnalysis: () => null, saveAnalysis: () => undefined },
		waveformPcmWindowContains: () => false, waveformPeaksHaveRms: () => false,
	};
	return { request: createWaveformPcmWindowRequester(runtime, registration.registerStoredChunkProvider),
		registration, registry, readProviders, source, metadata, storedMetadata, lookupStarted, createdProviders: () => createdProviders };
}

for (const peak of [false, true]) {
	test(`a late ${peak ? 'peak' : 'PCM'} waveform metadata lookup preserves the provider already captured by playback`, async () => {
		const f = fixture(peak);
		const waveform = f.request('first', { startFrame: 0, endFrame: 100, pixelWidth: 4 });
		await f.lookupStarted.promise;
		const playbackProvider = f.registration.registerStoredChunkProvider(f.source, f.metadata);
		assert.ok(playbackProvider);
		f.storedMetadata.resolve(f.metadata);
		assert.ok(await waveform);
		assert.strictEqual(f.registry.get(f.source.id), playbackProvider);
		assert.deepEqual(f.readProviders, [playbackProvider]);
		assert.doesNotThrow(() => playbackProvider.readStorageChunk(0));
		assert.equal(f.createdProviders(), 1);
	});
}

test('concurrent waveform lookups of two clips sharing one source publish one live provider', async () => {
	const f = fixture(false);
	const first = f.request('first', { startFrame: 0, endFrame: 100 });
	const second = f.request('second', { startFrame: 0, endFrame: 100 });
	await f.lookupStarted.promise;
	f.storedMetadata.resolve(f.metadata);
	await Promise.all([first, second]);
	assert.equal(f.createdProviders(), 1);
	assert.equal(f.readProviders.length, 2);
	assert.strictEqual(f.readProviders[0], f.readProviders[1]);
	assert.doesNotThrow(() => f.readProviders[0]!.readStorageChunk(0));
});
