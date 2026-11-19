/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

for (const reversed of [false, true]) test(`nonresident ${reversed ? 'reversed' : 'forward'} loop reads only its source period`, async context => {
	const sampleRate = 48_000, chunkFrames = 4_096, start = chunkFrames - 73, period = 480, phase = 117;
	const frameCount = chunkFrames * 4, durationFrames = period * 100;
	const source = createAudioSource({ id: 'source', sampleRate, frameCount, chunkFrames, channelCount: 1 });
	const track = createAudioTrack({ id: 'track', clipIds: ['clip'] });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: start,
		sourceDurationFrames: period, durationFrames, reversed,
		opaqueExtensions: withClipLoop(undefined, { periodFrames: period, offsetFrames: phase }) });
	const project = createSoundscaperProject({ id: 'loop', sampleRate, sources: [source], tracks: [track], clips: [clip] });
	const samples = Float32Array.from({ length: frameCount }, (_, index) => ((index * 19 % 251) - 125) / 512);
	const reads: number[] = [];
	const { createEngine } = createNodeWebAudioEngineFactory(context);
	const engine = createEngine();
	engine.loadProject(project, new Map(), { chunkSources: new Map([[source.id, { ...source,
		readStorageChunk(index: number) {
			reads.push(index);
			return [samples.subarray(index * chunkFrames, (index + 1) * chunkFrames)];
		},
	}]]) });
	const fromFrame = 305, toFrame = durationFrames - 211;
	const result = await engine.renderMix({ startFrame: fromFrame, endFrame: toFrame, includeTail: false });
	assert.ok(result instanceof AudioBuffer);
	assert.deepEqual([result.numberOfChannels, result.sampleRate, result.length], [2, sampleRate, toFrame - fromFrame]);
	let maximumError = 0;
	for (const channel of [result.getChannelData(0), result.getChannelData(1)]) {
		for (let frame = 256; frame < channel.length - 256; frame++) {
			const position = (phase + fromFrame + frame) % period;
			const input = samples[start + (reversed ? period - 1 - position : position)]!;
			maximumError = Math.max(maximumError, Math.abs(channel[frame]! - input * Math.SQRT1_2));
		}
	}
	assert.ok(maximumError < 1e-6, `loop PCM error ${String(maximumError)}`);
	assert.equal(reads.length, 2, 'the source period crosses two chunks and should read each exactly once');
	assert.deepEqual(reads, [0, 1]);
});
