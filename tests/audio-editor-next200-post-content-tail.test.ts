/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { renderStatelessOfflineToSink } from '../src/common/editor/engine/stateless-offline-stream.ts';
import { renderNativePluginRealtimePcmIfRequired } from '../src/common/editor/engine/native-plugin-realtime-render.ts';
import { registerNativePluginOfflineRuntimeProvider } from '../src/common/editor/native-plugin-realtime-node.js';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineRealtimeRenderOptions } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

for (const sampleRate of [8000, 48_000]) test(`selected ${sampleRate} Hz render preserves absolute time after the last clip`, async context => {
	const frameCount = sampleRate / 5, params = { time: 1, echoes: 2, echoGain: 0, mix: 1 };
	const source = createAudioSource({ id: 'source', sampleRate, frameCount, channelCount: 1 });
	const project = createSoundscaperProject({ id: `post-content-${sampleRate}`, sampleRate, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: frameCount, sourceDurationFrames: frameCount })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: [createEffect('multi-tap-delay', { id: 'delay', params })], spectrogram: { maximumFrequency: sampleRate / 2 } })] });
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
		softwareRenderer: ({ startFrame, endFrame, captureStartFrame, tailFrames }) => {
			assert.equal(typeof startFrame, 'number'); assert.equal(typeof endFrame, 'number'); assert.equal(typeof captureStartFrame, 'number');
			const start = Number(startFrame), end = Number(endFrame), capture = Number(captureStartFrame);
			const input = Float32Array.from({ length: end - start + Number(tailFrames) }, (_, index) =>
				start + index < frameCount ? .05 * Math.sin(2 * Math.PI * 500 * (start + index) / sampleRate) : 0);
			const output = new Float32Array(input.length), processor = createStandardDelayProcessor({ sampleRate, channelCount: 1, params });
			try { processor.processBlock([input], [output], input.length); } finally { processor.dispose(); }
			return { channels: [output.slice(capture - start)], sampleRate };
		},
	});
	context.after(async () => { await engine.dispose(); }); engine.loadProject(project);
	const full = await engine.renderMix({ includeTail: true }); assert.ok('channels' in full);
	for (const [start, end] of [[.05, .15], [1.05, 1.15], [2.05, 2.15], [3.05, 3.15]]) {
		const startFrame = Math.round(start * sampleRate), endFrame = Math.round(end * sampleRate);
		const selected = await engine.renderMix({ startFrame, endFrame, preRollFrames: startFrame }); assert.ok('channels' in selected);
		const actual = selected.channels[0]; assert.ok(actual instanceof Float32Array);
		assert.equal(actual.length, endFrame - startFrame);
		const expected = new Float32Array(actual.length);
		const available: unknown = full.channels[0]; assert.ok(available instanceof Float32Array);
		expected.set(available.subarray(startFrame, endFrame));
		assert.deepEqual(actual, expected, `selected ${start}..${end} must retain its authored silence and echo phase`);
	}
});

test('bounded stateless delivery retains a requested silent span after its source', async () => {
	const project: EngineProject = { sampleRate: 48_000, masterChannels: 2, sources: [{ id: 'source', channelCount: 2 }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, durationFrames: 4 }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], effects: [] }], master: { effects: [] } };
	let rendered = 0, delivered = 0;
	const engine = { project, sampleRate: 48_000, durationFrames: 4,
		async renderMix(range: { startFrame: number; endFrame: number }) {
			assert.equal(range.startFrame, 12); assert.equal(range.endFrame, 16); rendered++;
			return { length: 4, sampleRate: 48_000, numberOfChannels: 2, getChannelData: () => new Float32Array(4) };
		},
	} as unknown as EngineRuntimeHost;
	const result = await renderStatelessOfflineToSink(engine, { startFrame: 12, endFrame: 16,
		onChunk: channels => { assert.deepEqual(channels, [new Float32Array(4), new Float32Array(4)]); delivered++; } });
	assert.equal(result.frameCount, 4); assert.equal(rendered, 1); assert.equal(delivered, 1);
});

test('exact warped delivery preserves a selected silent span after the final clip', async context => {
	const source = createAudioSource({ id: 'warped-source', sampleRate: 48_000, channelCount: 1, frameCount: 4 });
	const clip = createAudioClip({ id: 'warped', sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4,
		warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 2, source: 1, mode: 'forward' }, { outer: 4, source: 4, mode: 'forward' }] } });
	const project = createSoundscaperProject({ id: 'warped-silence', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
	let rendered = 0, delivered = 0;
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
		softwareRenderer: ({ captureStartFrame, endFrame, sampleRate }) => {
			assert.equal(captureStartFrame, 12); assert.equal(endFrame, 16); rendered++;
			return { channels: [new Float32Array(4), new Float32Array(4)], sampleRate: Number(sampleRate) };
		},
	});
	context.after(async () => { await engine.dispose(); }); engine.loadProject(project);
	const result = await engine.renderMixToSink({ startFrame: 12, endFrame: 16, sink: channels => {
		assert.deepEqual(channels, [new Float32Array(4), new Float32Array(4)]); delivered++;
	} });
	assert.equal(result.frameCount, 4); assert.equal(rendered, 1); assert.equal(delivered, 1);
});

test('native plug-in capture admits the actual requested post-content range', async context => {
	const unregister = registerNativePluginOfflineRuntimeProvider(async () => { throw new Error('No helper instance is needed by this captured host.'); });
	context.after(unregister);
	const project = { sampleRate: 48_000, masterChannels: 2,
		tracks: [{ id: 'voice', type: 'audio', effects: [{ id: 'effect', type: 'native-plugin', params: { instanceId: 'plugin', latencyFrames: 0 } }] }],
		master: { effects: [] }, mixer: { groups: [], sends: [] }, nativePluginStates: [{ instanceId: 'plugin', format: 'clap',
			stablePluginId: 'org.example.effect', binarySha256: 'a'.repeat(64), enabled: true, bypassed: false, continuity: 'live',
			stateBody: { kind: 'native-plugin-state', bodyId: 'b'.repeat(64), byteLength: 3, sha256: 'c'.repeat(64) } }] };
	const host = { project, durationFrames: 4, sampleRate: 48_000,
		async renderMixRealtime(options: EngineRealtimeRenderOptions) {
			assert.equal(options.startFrame, 12); assert.equal(options.endFrame, 16);
			await options.onChunk?.([new Float32Array(4).fill(.25), new Float32Array(4).fill(.5)], { frameOffset: 0, frames: 4, sampleRate: 48_000 });
			return { sampleRate: 48_000, channelCount: 2, frameCount: 4, chunkCount: 1 };
		},
	} as unknown as EngineRuntimeHost;
	const rendered = await renderNativePluginRealtimePcmIfRequired(host, { startFrame: 12, endFrame: 16 });
	assert.ok(rendered); assert.deepEqual(rendered.channels, [new Float32Array(4).fill(.25), new Float32Array(4).fill(.5)]);
});
