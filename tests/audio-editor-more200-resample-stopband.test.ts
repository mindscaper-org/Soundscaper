/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createOfflineChunkResampleBuffer } from '../src/common/editor/engine/offline-chunk-resample.ts';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioContext, MockChunkStreamClient, MockNode } from './helpers/mock-audio-context.js';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
const rms = (values: readonly number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
for (const [inputRate, outputRate] of [[96_000, 8_000], [192_000, 8_000], [96_000, 48_000]] as const) {
	test(`File Open and Resample filter unsupported frequencies at ${String(inputRate)} to ${String(outputRate)} Hz`, async context => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
		const source = createAudioSource({ id: 'source', sampleRate: inputRate, frameCount: inputRate / 2, channelCount: 2 });
		const original = createSoundscaperProject({ id: `stopband-${String(inputRate)}-${String(outputRate)}`, sampleRate: 48_000, sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: source.frameCount })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
		for (let start = 0; start < source.frameCount; start += 65_536) {
			await writer.write([6000, 1000].map(frequency => Float32Array.from({ length: Math.min(65_536, source.frameCount - start) },
				(_, frame) => .25 * Math.sin(2 * Math.PI * frequency * (start + frame) / inputRate))));
		}
		await writer.commit();
		const archive = await exportScapeProject(original, archiveStore); assert.ok(archive.blob instanceof Blob);
		await archiveStore.close();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'High rate.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false); const before = controller.project;
		await controller.actions.clip.resample('clip', { sampleRate: outputRate });
		const after = controller.project; assert.ok(after);
		const clip = after.clips[0]; assert.ok(clip);
		const replacement = after.sources.find(candidate => candidate.id === clip.sourceId); assert.ok(replacement?.kind === 'audio');
		assert.equal(replacement.sampleRate, outputRate); assert.equal(replacement.frameCount, outputRate / 2);
		const channels: number[][] = [[], []];
		for await (const chunk of store.readSourceChunks(replacement.storageKey)) {
			for (const [index, channel] of chunk.channels.entries()) for (const value of channel) channels[index]!.push(value);
		}
		const levels = channels.map(channel => rms(channel.slice(outputRate / 10, outputRate * .4)));
		if (outputRate === 8000) assert.ok(levels[0]! < 1e-4, `6kHz must not fold into audible 2kHz: ${String(levels[0])}`);
		else assert.ok(Math.abs(levels[0]! - .25 / Math.SQRT2) < 1e-4);
		assert.ok(Math.abs(levels[1]! - .25 / Math.SQRT2) < 1e-4, `the supported 1kHz tone remains audible: ${String(levels[1])}`);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
	});
}

test('decimation bounds kernel allocation while explicit radii retain their existing lookahead', context => {
	const Original = Float64Array; let largestWeights = 0;
	const Tracked = new Proxy(Original, { construct(target, argumentsList: [number]) {
		largestWeights = Math.max(largestWeights, Number(argumentsList[0]));
		return new target(...argumentsList);
	} });
	context.mock.property(globalThis, 'Float64Array', Tracked);
	assert.equal(createStreamingWindowedSincResampler(768_000, 8000, 1).latencyInputFrames, 2304);
	assert.equal(createStreamingWindowedSincResampler(1e8, 8000, 1).latencyInputFrames, 4096);
	assert.equal(largestWeights, 8192, 'the channel-independent kernel remains within64KiB');
	assert.equal(createStreamingWindowedSincResampler(96_000, 8000, 1, { radius: 24 }).latencyInputFrames, 24);
	assert.equal(createStreamingWindowedSincResampler(8000, 48_000, 1).latencyInputFrames, 24);
	assert.equal(createStreamingWindowedSincResampler(48_000, 48_000, 1).latencyInputFrames, 0);
});

test('an interior offline selection supplies the complete antialias context at both ends', async () => {
	const samples = Float32Array.from({ length: 96_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 6000 * frame / 96_000));
	const context = new MockOfflineAudioContext({ numberOfChannels: 1, length: 2000, sampleRate: 8000 });
	const output = await createOfflineChunkResampleBuffer({ context: context as unknown as BaseAudioContext,
		source: { frameCount: samples.length, sampleRate: 96_000, channelCount: 1, chunkFrames: 65_536,
			readStorageChunk: (index: number) => [samples.subarray(index * 65_536, (index + 1) * 65_536)] },
		inputOffsetFrame: 24_000.5, inputFrameCount: 24_000, outputFrameCount: 2000 });
	assert.equal(output.length, 2000);
	assert.ok(output.getChannelData(0).every(sample => Math.abs(sample) < 1e-4), 'a selected range must retain the filter context outside its own endpoints');
});

test('live selection playback grants the worker the same complete filter context', async () => {
	const context = new MockAudioContext({ sampleRate: 8000 });
	const streams = new MockChunkStreamClient();
	const scheduled = await scheduleProjectClips({ context: context as unknown as BaseAudioContext,
		project: { sampleRate: 8000, tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
			clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
				sourceDurationFrames: 96_000, durationFrames: 8000 }] },
		sources: new Map(), chunkSources: new Map([['source', { frameCount: 96_000, sampleRate: 96_000,
			channelCount: 1, chunkFrames: 65_536, readStorageChunk: () => [new Float32Array(65_536)] }]]),
		trackInputs: new Map([['voice', new MockNode() as unknown as AudioNode]]),
		fromFrame: 2000, toFrame: 4000, contextStartTime: 0, sampleRate: 8000,
		reversedBuffers: new WeakMap(), sourceResolver: null, activeSources: new Set(), allNodes: [], mode: 'live',
		chunkStreamClient: streams as never,
		chunkAudioNodeFactory: async () => Object.assign(new MockNode(), { port: {} }) as unknown as AudioWorkletNode,
	});
	try {
		assert.equal(scheduled.streamedClips, 1); const request = streams.opens[0]; assert.ok(request);
		assert.equal(request.sourceStartFrame, 24_000 - 288);
		assert.equal(request.sourceEndFrame, 48_000 + 288);
		assert.equal(request.resampleInputOffset, 288); assert.equal(request.outputFrameCount, 2000);
	} finally { for (const handle of streams.handles) handle.cancel(); streams.dispose(); }
});
