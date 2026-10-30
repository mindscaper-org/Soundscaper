/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ownStatelessOfflineProject, renderStatelessOfflineToSink } from '../src/common/editor/engine/stateless-offline-stream.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

test('an owned stereo export uses its admitted width and checks immutable identity per packet', async (context) => {
	const project: EngineProject = { id: 'offline', sampleRate: 48_000, masterChannels: 2,
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'], effects: [] }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 300_000 }],
		sources: [{ id: 'source', channelCount: 2 }], master: { gain: 1, effects: [] } };
	ownStatelessOfflineProject(project);
	const stringify = JSON.stringify;
	let serializations = 0; let windows = 0;
	context.mock.method(JSON, 'stringify', (...args: Parameters<typeof JSON.stringify>) => {
		if (args[0] === project) serializations += 1;
		return stringify(...args);
	});
	const output = [new Float32Array(300_000), new Float32Array(300_000)];
	const engine = { project, sampleRate: 48_000, durationFrames: 300_000,
		async renderMix(range: { startFrame: number; endFrame: number }) {
			windows += 1;
			const length = range.endFrame - range.startFrame;
			assert.ok(length <= 240_000, 'the five-second window ceiling remains in force');
			return { length, sampleRate: 48_000, numberOfChannels: 2,
				getChannelData: (channel: number) => Float32Array.from({ length }, (_, index) => (channel ? -1 : 1) * ((range.startFrame + index) % 17) / 16) };
		},
	} as unknown as EngineRuntimeHost;
	const result = await renderStatelessOfflineToSink(engine, { chunkFrames: 4_096, onChunk(channels, { frameOffset }) {
		channels.forEach((channel, index) => output[index]!.set(channel, frameOffset));
	} });
	assert.equal(windows, 2);
	assert.equal(serializations, 0);
	assert.equal(result.frameCount, 300_000);
	for (let channel = 0; channel < 2; channel += 1) assert.deepEqual(output[channel], Float32Array.from({ length: 300_000 }, (_, index) => (channel ? -1 : 1) * (index % 17) / 16));
	assert.ok(Object.isFrozen(project.clips![0]));
});
