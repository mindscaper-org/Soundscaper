/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { audioBufferChannels } from '../src/common/editor/engine/buffer-math.ts';
import { resolveRenderTimelineRanges } from '../src/common/editor/engine/rendering-range.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineRealtimeRenderOptions } from '../src/common/editor/engine/public-api.ts';
import { registerNativePluginOfflineRuntimeProvider } from '../src/common/editor/native-plugin-realtime-node.js';
import { MockGainRenderingOfflineAudioContext, MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer } from './helpers/mock-audio-context.js';

const ranges = [{ startFrame: 0, endFrame: 24_000 }, { startFrame: 48_000, endFrame: 96_000 }];

function project(effects: readonly object[] = []) {
	return createAudioPreviewProject({ sampleRate: 48_000, masterChannels: 1,
		sources: [{ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 96_000, sourceDurationFrames: 96_000 }],
		tracks: [{ id: 'track', clipIds: ['clip'], effects,
			envelope: [{ frame: 0, value: 1 }, { frame: 24_000, value: 1 }, { frame: 48_000, value: .5 }, { frame: 96_000, value: .5 }] }],
	});
}

test('joined offline input schedules original source and envelope windows on one continuous graph', async () => {
	const contexts: MockGainRenderingOfflineAudioContext[] = [];
	const engine = createAudioEditorEngine({ audioContextFactory: null,
		offlineAudioContextFactory: options => {
			const context = new MockGainRenderingOfflineAudioContext(options); contexts.push(context);
			return context as unknown as OfflineAudioContext;
		} });
	const buffer = new MockAudioBuffer(1, 96_000, 48_000); buffer.getChannelData(0).fill(.25);
	buffer.getChannelData(0).fill(1, 24_000, 48_000);
	engine.loadProject(project(), new Map([['source', buffer as unknown as AudioBuffer]]));
	try {
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 96_000, joinedRanges: ranges, includeTail: false });
		assert.equal(contexts.length, 1, 'all original source windows share one processing graph');
		const channels = audioBufferChannels(rendered);
		assert.equal(channels[0]?.length, 72_000);
		assert.deepEqual(contexts[0]!.bufferSources.map(source => source.started), [[0, 0, .5], [.5, 1, 1]]);
		assert.equal(channels[0]?.[12_000], .25);
		assert.equal(channels[0]?.[48_000], .125, 'the second input keeps its original authored .5 envelope');
	} finally { await engine.dispose(); }
});

test('native plug-in delegation retains joined intervals and admits the joined output rather than the removed gap', async t => {
	const unregister = registerNativePluginOfflineRuntimeProvider(async () => { throw new Error('The test owns delegated capture.'); });
	t.after(unregister);
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	engine.loadProject(project([{ id: 'effect', type: 'native-plugin', enabled: true, params: { instanceId: 'authored', latencyFrames: 0 } }]));
	const calls: EngineRealtimeRenderOptions[] = [];
	engine.renderMixRealtime = async (options = {}) => {
		calls.push(options);
		assert.ok(options.onChunk);
		await options.onChunk([new Float32Array(72_000).fill(.125)], { frameOffset: 0, sampleRate: 48_000 });
		return { sampleRate: 48_000, channelCount: 1, frameCount: 72_000, chunkCount: 1 };
	};
	try {
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 96_000, joinedRanges: ranges, trackId: 'track', includeMaster: false });
		const channels = audioBufferChannels(rendered);
		assert.equal(channels[0]?.length, 72_000);
		assert.equal(channels[0]?.[71_999], .125);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]!.joinedRanges, ranges);
	} finally { await engine.dispose(); }
});

test('joined rendering warms up before the first retained window and crops the shared graph only once', async () => {
	const contexts: MockOfflineAudioContext[] = [];
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: options => {
		const context = new MockOfflineAudioContext(options); contexts.push(context);
		return context as unknown as OfflineAudioContext;
	} });
	engine.loadProject(project([{ id: 'echo', type: 'delay', params: { mix: 1, time: .25, feedback: 0 } }]),
		new Map([['source', new MockAudioBuffer(1, 96_000, 48_000) as unknown as AudioBuffer]]));
	try {
		const rendered = await engine.renderMix({ startFrame: 48_000, endFrame: 96_000,
			joinedRanges: [{ startFrame: 48_000, endFrame: 60_000 }, { startFrame: 84_000, endFrame: 96_000 }] });
		assert.equal(audioBufferChannels(rendered)[0]?.length, 24_000);
		assert.equal(contexts[0]!.length, 36_000, 'one quarter-second of echo history precedes the joined capture');
		assert.deepEqual(contexts[0]!.bufferSources.map(source => source.started), [[0, .75, .5], [.5, 1.75, .25]]);
	} finally { await engine.dispose(); }
});

test('stateless exact-warp streaming skips the gap while retaining original source coordinates', async () => {
	const calls: Array<readonly [number, number]> = [];
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
		audioWarpRealtimeAcceleration: false, softwareRenderer: options => {
			const start = Number(options.captureStartFrame), end = Number(options.endFrame); calls.push([start, end]);
			return { sampleRate: 48_000, channels: [Float32Array.from({ length: end - start }, (_, frame) => start + frame)] };
		} });
	const warped = project();
	const clip = warped.clips?.[0]; assert.ok(clip);
	Object.assign(clip, { warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 0, mode: 'forward' }, { outer: 96_000, source: 96_000, mode: 'forward' },
	] } });
	engine.loadProject(warped);
	const chunks: Float32Array[] = [];
	try {
		const result = await engine.renderMixRealtime({ startFrame: 0, endFrame: 96_000, joinedRanges: ranges,
			onChunk: channels => { assert.ok(channels[0]); chunks.push(channels[0]); } });
		const samples = Float32Array.from(chunks.flatMap(chunk => [...chunk]));
		assert.equal(result.frameCount, 72_000);
		assert.equal(samples[23_999], 23_999); assert.equal(samples[24_000], 48_000); assert.equal(samples[71_999], 95_999);
		assert.ok(calls.every(([start, end]) => end <= 24_000 || start >= 48_000));
	} finally { await engine.dispose(); }
});

test('joined range admission rejects ambiguous ordering without changing ordinary empty renders', () => {
	assert.deepEqual(resolveRenderTimelineRanges(5, 5), { ranges: [{ startFrame: 5, endFrame: 5 }], frameCount: 0 });
	for (const invalid of [[], [{ startFrame: 0, endFrame: 10 }, { startFrame: 9, endFrame: 20 }],
		[{ startFrame: 1, endFrame: 20 }], [{ startFrame: 0, endFrame: 20.5 }]]) {
		assert.throws(() => resolveRenderTimelineRanges(0, 20, invalid), RangeError);
	}
});
