/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import type { EngineChunkSource, EngineProject } from '../src/common/editor/engine/types.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

for (const sourceRate of [24_000, 48_000, 96_000, 768_000]) for (const reversed of [false, true]) {
	test(`one input sample per output frame preserves cropped ${reversed ? 'reversed' : 'forward'} ${sourceRate}Hz PCM on a bounded native context`, async () => {
		const samples = Float32Array.from({ length: 80_000 }, (_, frame) => .2 * Math.sin(frame * .03));
		const context = new MockAudioContext({ sampleRate: 48_000 });
		const allocate = context.createBuffer.bind(context);
		context.createBuffer = (channels: number, length: number, rate: number) => {
			if (rate > 96_000) throw new DOMException('The native buffer rate is unsupported.', 'NotSupportedError');
			return allocate(channels, length, rate);
		};
		const project: EngineProject = { sampleRate: 48_000,
			tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
			clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 12_345, sourceStartFrame: 200,
				durationFrames: 70_000, sourceDurationFrames: 70_000, speedRatio: 48_000 / sourceRate,
				linkPitchAndTempo: true, reversed }] };
		const provider: EngineChunkSource = { channelCount: 1, sampleRate: sourceRate,
			frameCount: samples.length, chunkFrames: 4_096,
			readStorageChunk: index => [samples.subarray(index * 4_096, (index + 1) * 4_096)] };
		await scheduleProjectClips({ context: context as unknown as BaseAudioContext, project,
			sources: new Map(), chunkSources: new Map([['source', provider]]),
			trackInputs: new Map([['voice', context.createGain() as unknown as AudioNode]]),
			fromFrame: 12_345 + 500, toFrame: 12_345 + 70_000 - 333, sampleRate: 48_000, contextStartTime: .25,
			reversedBuffers: new WeakMap(), sourceResolver: null, activeSources: new Set(), allNodes: [], mode: 'offline' });
		const nodes = context.bufferSources as unknown as readonly {
			buffer: AudioBuffer; playbackRate: { value: number }; started: readonly [number, number, number];
		}[];
		assert.ok(nodes.length > 2);
		const expected = samples.slice(200, 70_200);
		if (reversed) expected.reverse();
		const selected = expected.slice(500, expected.length - 333);
		const actual: number[] = [];
		for (const node of nodes) {
			assert.equal(node.buffer.sampleRate * node.playbackRate.value, 48_000);
			assert.ok(Math.abs(node.started[0] - (.25 + actual.length / 48_000)) < 1e-12);
			const start = Math.round(node.started[1] * node.buffer.sampleRate);
			const count = Math.round(node.started[2] * node.buffer.sampleRate);
			actual.push(...node.buffer.getChannelData(0).subarray(start, start + count));
		}
		assert.deepEqual(Float32Array.from(actual), selected);
	});
}
