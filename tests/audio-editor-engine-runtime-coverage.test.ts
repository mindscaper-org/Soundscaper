/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import {
	abortable,
	createAbortError,
	longSourceError,
	parametricEqProcessingError,
	throwIfAborted,
} from '../src/common/editor/engine/async-utils.ts';
import {
	mergeFrameRanges,
	normalizeChunkSource,
	normalizeSourceResolver,
	resolveClipSource,
} from '../src/common/editor/engine/clip-schedule-plan.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import {
	effectRackLatencyFrames,
	postEffectMessage,
	readParametricEqSpectrumEntry,
} from '../src/common/editor/engine/effect-rack.ts';
import {
	activeRackEffects,
	projectEffectRacks,
	projectRackEffect,
	projectWithEffectParams,
	projectWithParametricEqParams,
} from '../src/common/editor/engine/project-effects.ts';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import type {
	EngineChunkSource,
	EngineProject,
} from '../src/common/editor/engine/types.ts';

test('async helpers settle, abort, and preserve structured processing errors', async () => {
	const nativeAbort = createAbortError();
	assert.equal(nativeAbort.name, 'AbortError');

	throwIfAborted(null);
	const aborted = new AbortController();
	aborted.abort();
	assert.throws(() => throwIfAborted(aborted.signal), { name: 'AbortError' });
	assert.equal(await abortable(Promise.resolve('done'), null), 'done');

	const resolving = new AbortController();
	assert.equal(await abortable(Promise.resolve(4), resolving.signal), 4);
	const rejection = new Error('mock rejection');
	const rejecting = new AbortController();
	await assert.rejects(abortable(Promise.reject(rejection), rejecting.signal), rejection);

	let resolvePending!: (value: string) => void;
	const pendingController = new AbortController();
	const pending = abortable(new Promise<string>((resolve) => { resolvePending = resolve; }), pendingController.signal);
	pendingController.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	resolvePending('late');

	assert.equal(longSourceError('render it').code, 'LONG_SOURCE_RENDER_REQUIRED');
	assert.deepEqual(
		Object.assign({}, parametricEqProcessingError({ message: 'EQ failed', status: 5, effectId: 'eq-1' })),
		{ name: 'ParametricEqProcessingError', status: 5, effectId: 'eq-1' },
	);
	assert.match(parametricEqProcessingError(null).message, /failed during rendering/u);
	assert.equal(parametricEqProcessingError({ message: '', status: null, effectId: '' }).status, undefined);
});

test('clip planning bounds chunks, merges ranges, and resolves cached audio', async () => {
	assert.equal(normalizeSourceResolver(undefined), null);
	assert.throws(() => normalizeChunkSource({
		channelCount: 1,
		frameCount: 1,
		chunkFrames: 65_537,
		sampleRate: 48_000,
		readStorageChunk() { return [Float32Array.of(0)]; },
	}), /cannot exceed/u);


	assert.deepEqual(mergeFrameRanges([[5, 9], [1, 3], [3, 6], [8, 8]]), [[1, 9]]);

	const audioBuffer = {
		length: 4,
		sampleRate: 48_000,
		getChannelData: () => new Float32Array(4),
	} as unknown as AudioBuffer;
	const clip = { id: 'clip', sourceId: 'source', sourceStartFrame: 2 };
	const project: EngineProject = { clips: [clip] };
	assert.strictEqual(resolveClipSource(clip, project, new Map(), () => audioBuffer).buffer, audioBuffer);

});

test('reversed offline chunk scheduling reads cross-chunk ranges in reverse order', async () => {
	const context = new TestAudioContext(4);
	const provider: EngineChunkSource = {
		channelCount: 1,
		frameCount: 6,
		chunkFrames: 4,
		sampleRate: 4,
		readStorageChunk(index) {
			if (index === 0) return [Float32Array.of(0, 1, 2, 3)];
			if (index === 1) return { channels: [Float32Array.of(4, 5)] };
			throw new RangeError('missing chunk');
		},
	};
	const project: EngineProject = {
		sampleRate: 4,
		clips: [{
			id: 'clip',
			sourceId: 'source',
			timelineStartFrame: 0,
			durationFrames: 6,
			sourceStartFrame: 0,
			sourceDurationFrames: 6,
			reversed: true,
		}],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
	};
	const progress: number[] = [];
	const activeSources = new Set<import('../src/common/editor/engine/project-graph.ts').AudioScheduledSourceNode>();
	await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project,
		sources: new Map(),
		chunkSources: new Map([['source', provider]]),
		trackInputs: new Map([['track', new TestAudioNode() as unknown as AudioNode]]),
		fromFrame: 0,
		toFrame: 6,
		contextStartTime: 0,
		sampleRate: 4,
		reversedBuffers: new WeakMap(),
		sourceResolver: null,
		activeSources,
		allNodes: [] as AudioNode[],
		mode: 'offline',
		onProgress: ({ progress: value }) => progress.push(value),
	});

	assert.deepEqual(context.buffers.map((buffer) => [...buffer.getChannelData(0)]), [
		[5, 4, 3, 2],
		[1, 0],
	]);
	assert.deepEqual(context.sources.map((source) => source.started), [
		[0, 0, 1],
		[1, 0, 0.5],
	]);
	assert.equal(activeSources.size, 2);
	assert.equal(progress.at(-1), 1);

	const directProject: EngineProject = {
		sampleRate: 4,
		clips: [{
			id: 'direct-clip', sourceId: 'direct-source', timelineStartFrame: 0,
			durationFrames: 6, sourceStartFrame: 0, sourceDurationFrames: 6, reversed: false,
		}],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['direct-clip'] }],
	};
	const directOptions = (chunkSource: EngineChunkSource, directContext = new TestAudioContext(4)) => ({
		context: directContext as unknown as BaseAudioContext,
		project: directProject,
		sources: new Map<unknown, AudioBuffer>(),
		chunkSources: new Map([['direct-source', chunkSource]]),
		trackInputs: new Map([['track', new TestAudioNode() as unknown as AudioNode]]),
		fromFrame: 0,
		toFrame: 6,
		contextStartTime: 0,
		sampleRate: 4,
		reversedBuffers: new WeakMap<AudioBuffer, AudioBuffer>(),
		sourceResolver: null,
		activeSources: new Set<import('../src/common/editor/engine/project-graph.ts').AudioScheduledSourceNode>(),
		allNodes: [] as AudioNode[],
	});
	await assert.rejects(scheduleProjectClips({
		...directOptions(provider),
		mode: 'live',
		chunkStreamClient: null,
	}), { code: 'LONG_SOURCE_RENDER_REQUIRED' });
	await scheduleProjectClips({
		...directOptions({
			...provider,
			readStorageChunk() { return [new Float32Array()]; },
		}),
		mode: 'offline',
	});
	await assert.rejects(scheduleProjectClips({
		...directOptions({
			...provider,
			channelCount: 2,
			readStorageChunk() { return [new Float32Array(4)]; },
		}),
		mode: 'offline',
	}), /missing channels/u);
});

test('offline time-stretched chunks use one phase-continuous resample', async () => {
	const context = new TestAudioContext(8);
	const input = Float32Array.from({ length: 20 }, (_, frame) => Math.sin(frame * 0.7));
	const reads: number[] = [];
	const provider: EngineChunkSource = {
		channelCount: 1, frameCount: 20, chunkFrames: 4, sampleRate: 8,
		readStorageChunk(index) {
			reads.push(index);
			return [input.slice(index * 4, Math.min(input.length, (index + 1) * 4))];
		},
	};
	await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: {
			sampleRate: 8,
			clips: [{
				id: 'clip', sourceId: 'source', timelineStartFrame: 0,
				durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 13,
			}],
			tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		},
		sources: new Map(), chunkSources: new Map([['source', provider]]),
		trackInputs: new Map([['track', new TestAudioNode() as unknown as AudioNode]]),
		fromFrame: 1, toFrame: 8, contextStartTime: 0, sampleRate: 8,
		reversedBuffers: new WeakMap(), sourceResolver: null,
		activeSources: new Set(), allNodes: [] as AudioNode[], mode: 'offline',
	});
	assert.deepEqual(reads, [0, 1, 2, 3, 4]);
	assert.deepEqual(context.buffers.map(({ length }) => length), [7]);
	assert.equal(context.sources.length, 1);
	const resampler = createStreamingWindowedSincResampler(11.375, 7, 1, {
		initialInputPosition: 1.625,
	}) as unknown as {
		push(channels: Float32Array[]): Float32Array[];
		finish(frames: number): Float32Array[];
	};
	const first = resampler.push([input])[0] as Float32Array;
	const tail = resampler.finish(7)[0] as Float32Array;
	assert.deepEqual([...context.buffers[0]!.getChannelData(0)], [...first, ...tail]);
});

test('effect rack and project helpers cover invalid and inactive graph paths', () => {
	assert.equal(effectRackLatencyFrames(undefined), 0);
	assert.deepEqual(activeRackEffects(null), []);
	assert.deepEqual(activeRackEffects({ effectsActive: false, effects: [{ type: 'limiter' }] }), []);
	assert.deepEqual([...projectEffectRacks(undefined)], [{
		scope: 'master', targetId: null, effectsActive: true, effects: [],
	}]);

	const delay = { id: 'delay', type: 'delay', params: { mix: 0.2 } };
	const eq = { id: 'eq', type: 'eq', params: { outputGain: 0 } };
	const project: EngineProject = {
		tracks: [
			{ id: 'labels', type: 'label' },
			{ id: 'track', type: 'audio', effects: [delay, eq] },
		],
		mixer: {
			groups: [{ id: 'group', effects: [delay] }],
			sends: [{ id: 'send', effects: [eq] }],
		},
		master: { effects: [eq] },
	};
	assert.equal(projectRackEffect(project, 'track', 'missing', 'delay'), null);
	assert.equal(projectWithEffectParams(null, 'master', null, 'eq', {}), null);
	assert.equal(projectWithEffectParams(project, 'track', 'missing', 'delay', {}), null);
	assert.equal(projectWithEffectParams(project, 'master', null, 'missing', {}), null);
	assert.equal(projectWithParametricEqParams(project, 'track', 'track', 'delay', {}), null);
	assert.deepEqual(
		projectWithEffectParams(project, 'send', 'send', 'eq', { outputGain: 3 })?.mixer?.sends?.[0]?.effects?.[0]?.params,
		{ outputGain: 3 },
	);

	assert.equal(postEffectMessage(null, 'master', null, 'effect', {}), false);

	const missingTarget = new Float32Array(2).fill(0);
	assert.equal(readParametricEqSpectrumEntry(null, 'input', missingTarget), null);
	assert.deepEqual([...missingTarget], [-Infinity, -Infinity]);

});

test('rendering and transport require a loaded project', async () => {
	const empty = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
	});
	await assert.rejects(empty.renderMix(), /Load an audio editor project/u);
	await assert.rejects(empty.renderMixRealtime({ onChunk() {} }), /Load an audio editor project/u);
	await assert.rejects(empty.play(), /Load an audio editor project/u);
	await assert.rejects(empty.playAtSpeed(2), /Load an audio editor project/u);
	await assert.rejects(empty.playAt(0), /Load an audio editor project/u);
	await assert.rejects(empty.scrub(0), /Load an audio editor project/u);

	await empty.dispose();
});

class TestAudioParam {
	value = 0;

	setValueAtTime(value: number): void {
		this.value = value;
	}

	linearRampToValueAtTime(value: number): void {
		this.value = value;
	}
}

class TestAudioNode {
	disconnected = false;

	connect(): TestAudioNode {
		return this;
	}

	disconnect(): void {
		this.disconnected = true;
	}
}

class TestGainNode extends TestAudioNode {
	readonly gain = new TestAudioParam();
}

class TestAudioBuffer {
	readonly channels: Float32Array[];

	constructor(
		readonly numberOfChannels: number,
		readonly length: number,
		readonly sampleRate: number,
	) {
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	copyToChannel(values: Float32Array, channel: number): void {
		this.channels[channel]?.set(values);
	}

	getChannelData(channel: number): Float32Array {
		return this.channels[channel] as Float32Array;
	}
}

class TestBufferSourceNode extends TestAudioNode {
	buffer: TestAudioBuffer | null = null;
	readonly playbackRate = new TestAudioParam();
	onended: (() => void) | null = null;
	started: readonly [number, number, number] | null = null;

	start(when = 0, offset = 0, duration = 0): void {
		this.started = [when, offset, duration];
	}
}

class TestAudioContext {
	readonly currentTime = 0;
	readonly buffers: TestAudioBuffer[] = [];
	readonly sources: TestBufferSourceNode[] = [];

	constructor(readonly sampleRate: number) {}

	createGain(): TestGainNode {
		return new TestGainNode();
	}

	createBuffer(channelCount: number, frameCount: number, sampleRate: number): TestAudioBuffer {
		const buffer = new TestAudioBuffer(channelCount, frameCount, sampleRate);
		this.buffers.push(buffer);
		return buffer;
	}

	createBufferSource(): TestBufferSourceNode {
		const source = new TestBufferSourceNode();
		this.sources.push(source);
		return source;
	}
}
