/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lowClockPcmFixture } from './helpers/low-clock-pcm-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import { createHarness, target } from './helpers/effect-result-service-fixture.ts';
import { SOURCE_CHUNK_FRAMES } from '../src/common/editor/source-pcm-contract.ts';
import { MockAudioBuffer } from './helpers/mock-audio-context.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const rate of [1000, 48000] as const) for (const partial of [false, true]) test(`Source monitor Invert preserves native ${rate} Hz PCM, partial=${String(partial)}`, async context => {
	const engine = { ...createMemoryEngine(), async getAudioContext() { return { sampleRate: 48_000,
		createBuffer(channels: number, frames: number, sampleRate: number) {
			if (sampleRate < 3000) throw new DOMException('Native buffer rate unsupported.', 'NotSupportedError');
			return new MockAudioBuffer(channels, frames, sampleRate);
		} }; } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const { file, channel } = lowClockPcmFixture(rate);
	await controller.actions.project.importFiles([file]);
	const clip = controller.project?.clips[0], original = controller.project?.sources[0]; assert.ok(clip?.kind === 'audio'); assert.ok(original?.kind === 'audio');
	const startFrame = partial ? rate / 4 : 0, endFrame = partial ? rate * 3 / 4 : rate;
	controller.actions.effects.setSourceSelection({ clipId: clip.id, startFrame, endFrame });
	await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });
	const updatedClip = controller.project?.clips[0], result = controller.project?.sources.find(source => source.id === updatedClip?.sourceId);
	assert.ok(result?.kind === 'audio'); assert.notEqual(result.id, original.id);
	assert.equal(result.sampleRate, rate); assert.equal(result.frameCount, rate);
	const chunk = await store.readSourceChunk(result.storageKey, 0); assert.ok(chunk);
	assert.deepEqual(chunk.channels[0], Float32Array.from(channel, (sample, frame) => frame >= startFrame && frame < endFrame ? -sample : sample));
	controller.actions.edit.undo(); assert.equal(controller.project?.clips[0]?.sourceId, original.id);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips[0]?.sourceId, result.id);
});

for (const lateFailure of [false, true]) test(`source merge cancellation fences late window failure=${String(lateFailure)}`, async () => {
	const source = { id: 'source', kind: 'audio', frameCount: SOURCE_CHUNK_FRAMES + 10, channelCount: 1, sampleRate: 1000 };
	const abort = new AbortController(); let reads = 0, bufferReads = 0;
	type Window = { sourceId: string; startFrame: number; endFrame: number; channels: Float32Array[] };
	let resolve!: (value: Window | null) => void, reject!: (error: Error) => void;
	const held = new Promise<Window | null>((done, fail) => { resolve = done; reject = fail; });
	const service = createSourceEditorEffects({
		getProject: () => ({ id: 'project', schemaVersion: 1, sampleRate: 48_000, sources: [source],
			tracks: [{ id: 'track', type: 'audio', name: 'Audio', clipIds: ['clip'] }],
			clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount }] }),
		loadSourceBuffer: async () => { bufferReads++; throw new Error('Native buffer is unavailable.'); },
		loadSourceWindow: async (_source, request) => { reads++; assert.equal(request.signal, abort.signal); return held; },
		publishDocumentSnapshot() {},
	});
	service.setSourceSelection({ clipId: 'clip', startFrame: 1, endFrame: 2 });
	const pending = service.expandResult(service.target()!, [Float32Array.of(.5)], abort.signal);
	abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
	if (lateFailure) reject(new Error('Late storage failure.'));
	else resolve({ sourceId: 'source', startFrame: 0, endFrame: SOURCE_CHUNK_FRAMES, channels: [new Float32Array(SOURCE_CHUNK_FRAMES)] });
	await new Promise<void>(resolve => { setImmediate(resolve); });
	assert.equal(reads, 1); assert.equal(bufferReads, 0);
});

for (const failure of ['none', 'write', 'peaks', 'other-native'] as const) test(`optional native effect buffer: ${failure}`, async () => {
	const channels = [Float32Array.of(.25, -.5)];
	const error = new Error('Storage or native allocation failure.'); let persisted: Float32Array | undefined;
	const harness = createHarness({ runtime: {
		bufferFromChannels: async () => { throw failure === 'other-native' ? error : new DOMException('Rate unsupported.', 'NotSupportedError'); },
		writeBuffer: async (writer, buffer) => {
			assert.equal(buffer.sampleRate, 1000); assert.equal(buffer.numberOfChannels, 1);
			persisted = buffer.getChannelData(0);
			if (failure === 'write') throw error;
			await writer.write([persisted]);
		},
		generateWaveformPeaks: async () => { if (failure === 'peaks') throw error; return {}; },
	} });
	const pending = harness.service.persistAudacityEffectResults([{ target: { ...target('track'), sourceSampleRate: 1000 }, channels }], 'audacity-invert');
	if (failure === 'none') {
		await pending; assert.deepEqual(persisted, channels[0]); assert.equal(harness.events.commits.length, 1);
	} else {
		await assert.rejects(pending, error); assert.equal(harness.events.commits.length, 0);
		assert.deepEqual(harness.events.sourcesAborted, failure === 'write' ? ['audacity-effect-1'] : []);
		assert.deepEqual(harness.events.sourcesDeleted, failure === 'peaks' ? ['audacity-effect-1'] : []);
	}
	assert.deepEqual(harness.events.buffersCached, []); assert.equal(harness.sourceBuffers.size, 0);
});
