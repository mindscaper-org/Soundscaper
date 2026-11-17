/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { renderLinkedClipAudio } from '../src/common/editor/controller/clip-video/internal/linked-clip-render.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

test('Render pitch and speed leaves the retained clip delay out of its new source', async context => {
	const native = createNodeWebAudioEngineFactory(context);
	const buffer = new AudioBuffer({ numberOfChannels: 1, length: 24000, sampleRate: 48000 });
	buffer.getChannelData(0)[4000] = .8;
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: [{ id: 'source', frameCount: buffer.length, sampleRate: 48000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 12000, sourceDurationFrames: 24000,
			speedRatio: 2, linkPitchAndTempo: true, effects: [createEffect('delay', { params: { time: .05, mix: 1, feedback: 0 } })] }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
	});
	const runtime = projectForRuntimeConsumers(project) as unknown as ClipTransformProject;
	const resources = { createEngine: native.createEngine, sourceChunkProviders: new Map(),
		sourceBuffers: new Map([['source', buffer as unknown as globalThis.AudioBuffer]]),
	};
	const output = await renderLinkedClipAudio(resources, runtime, runtime.clips[0]!, runtime.sources[0]!, new AbortController().signal);
	const dry = await renderLinkedClipAudio(resources, runtime, { ...runtime.clips[0]!, effects: [] }, runtime.sources[0]!, new AbortController().signal);
	const pcm = output.getChannelData(0), peak = pcm.reduce((best, sample, frame) => Math.abs(sample) > Math.abs(pcm[best]!) ? frame : best, 0);
	assert.ok(pcm[peak]! > .7, 'the ordinary retimed source remains audible');
	assert.deepEqual(pcm, dry.getChannelData(0), 'the authored rack must not change the new retimed source');
	assert.ok(Array.isArray(project.clips[0]!.effects));
	assert.equal(project.clips[0]!.effects.length, 1, 'the authored rack remains on the replacement clip');
});
