/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { renderClipNormalizationAudio } from '../src/common/editor/controller/clip-video/internal/clip-normalization-render.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

test('clip normalization measures the stereo output of a mono clip reverb', async context => {
	const native = createNodeWebAudioEngineFactory(context);
	const buffer = new AudioBuffer({ numberOfChannels: 1, length: 24000, sampleRate: 48000 });
	for (let i = 0; i < buffer.length; i++) buffer.getChannelData(0)[i] = .2 * Math.sin(i * Math.PI / 24);
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: [{ id: 'source', frameCount: buffer.length, sampleRate: 48000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: buffer.length, effects: [createEffect('reverb')] }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
	});
	const runtime = projectForRuntimeConsumers(project), engine = native.createEngine();
	engine.loadProject(runtime, new Map([['source', buffer as unknown as globalThis.AudioBuffer]]));
	const expected = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: buffer.length,
		includeTail: false, includeMaster: false, includeTrackPan: false, preRollFrames: 0 }));
	await engine.dispose();
	const input = runtime as unknown as ClipTransformProject;
	const measured = await renderClipNormalizationAudio({ createEngine: native.createEngine, sourceChunkProviders: new Map(),
		prepare: async () => {},
	}, input, input.clips[0]!, buffer, new AbortController().signal);
	assert.equal(measured.numberOfChannels, expected.length, 'normalization must not fold stereo to mono');
	const peak = (channels: readonly Float32Array[]) => channels.reduce((maximum, channel) => {
		for (const sample of channel) maximum = Math.max(maximum, Math.abs(sample)); return maximum;
	}, 0);
	assert.ok(Math.abs(peak(audioBufferChannels(measured)) - peak(expected)) < .000001);
	await native.dispose();
});
