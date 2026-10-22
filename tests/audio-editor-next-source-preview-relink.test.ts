/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipSourcePreviewService, type ClipSourcePreviewEngine } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { EngineSourceBufferInput, EngineChunkSourceInput } from '../src/common/editor/engine/public-api.ts';

function buffer(value: number): AudioBuffer {
	const samples = new Float32Array(48_000).fill(value);
	return { sampleRate: 48_000, length: samples.length, duration: 1, numberOfChannels: 1,
		getChannelData: () => samples, copyFromChannel: destination => { destination.set(samples.subarray(0, destination.length)); },
		copyToChannel: source => { samples.set(source); } };
}

for (const asMap of [true, false]) for (const kind of ['buffer', 'provider'] as const) {
	test(`Source Monitor resumes fresh ${kind} identity from ${asMap ? 'Map' : 'record'} after scoped preparation`, async () => {
		const oldBuffer = buffer(.2), freshBuffer = buffer(.7), oldProvider = {}, freshProvider = {};
		const buffers = asMap ? new Map<unknown, AudioBuffer>([['source', oldBuffer]]) : { source: oldBuffer };
		const providers = asMap ? new Map<unknown, unknown>([['source', oldProvider]]) : { source: oldProvider };
		const project = { id: 'source-preview-relink', sampleRate: 48_000,
			tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
			sources: [{ id: 'source', kind: 'audio', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 }],
			clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000, pitchCents: 0, speedRatio: 1 }],
		};
		const generation = new EditorProjectGeneration(); generation.activate(project.id);
		const lifetime = new EditorControllerLifetime(); lifetime.markReady();
		const loaded: unknown[] = [];
		let prepareReplacement = false, position = 0, disposeCount = 0;
		let onPosition = (_frame: number) => {};
		const engine: ClipSourcePreviewEngine = {
			loadProject(_project, currentBuffers, options) {
				const input: EngineSourceBufferInput | EngineChunkSourceInput = kind === 'buffer' ? currentBuffers : options.chunkSources ?? {};
				loaded.push(input instanceof Map ? input.get('source') : Object.getOwnPropertyDescriptor(input, 'source')?.value);
			},
			async play() {}, pause() {}, stop() {}, setLoop() {}, setPlayRange() {},
			seek(frame) { position = frame; onPosition(frame); return frame; },
			subscribePosition(listener) { onPosition = listener; return () => {}; },
			dispose() { disposeCount++; },
		};
		const service = createClipSourcePreviewService({ lifetime, getProject: () => project,
			captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token), handleError: error => { throw error; },
			resources: { sourceBuffers: buffers, sourceChunkProviders: providers, createEngine: () => engine,
				async prepare(_project, _signal, options) {
					assert.deepEqual(options?.clipIds, ['clip']);
					if (!prepareReplacement) return;
					if (kind === 'buffer') { if (buffers instanceof Map) buffers.set('source', freshBuffer); else buffers.source = freshBuffer; }
					else if (providers instanceof Map) providers.set('source', freshProvider); else providers.source = freshProvider;
				}, retirePlayback() {}, subscribeTimelineState: () => () => {},
			},
		});
		try {
			service.setLoop(true); await service.playPause('clip'); await service.playPause('clip');
			if (buffers instanceof Map) buffers.set('unused', buffer(.9)); else Object.defineProperty(buffers, 'unused', { value: buffer(.9), enumerable: true });
			service.seek(12_000); await service.playPause('clip'); await service.playPause('clip');
			assert.equal(loaded.length, 1, 'unchanged resource identities preserve the loaded private project');
			prepareReplacement = true; await service.playPause('clip');
			assert.equal(loaded.length, 2); assert.equal(loaded[0], kind === 'buffer' ? oldBuffer : oldProvider);
			assert.equal(loaded[1], kind === 'buffer' ? freshBuffer : freshProvider);
			assert.equal(position, 12_000); assert.equal(service.snapshot().loop, true);
		} finally { await service.dispose(); }
		assert.equal(disposeCount, 1);
	});
}
