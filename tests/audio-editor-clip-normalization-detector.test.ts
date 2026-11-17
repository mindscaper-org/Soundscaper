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

test('normalizing a moved Auto Duck clip retains its guide PCM and clock', async context => {
	const native = createNodeWebAudioEngineFactory(context);
	const music = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });
	const voice = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });
	music.getChannelData(0).fill(.25); voice.getChannelData(0).fill(.5, 24000, 36000);
	const project = createSoundscaperProject({ sampleRate: 48000, masterChannels: 1,
		sources: ['music', 'voice'].map(id => ({ id, frameCount: 48000, sampleRate: 48000, channelCount: 1 })),
		clips: [{ id: 'music', sourceId: 'music', timelineStartFrame: 12000, durationFrames: 36000,
			effects: [createEffect('audacity-auto-duck', { context: { controlTrackId: 'voice' },
				params: { outerFadeDown: .1, outerFadeUp: .1, maximumPause: .1 } })] },
		{ id: 'voice', sourceId: 'voice', durationFrames: 48000 }],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['music'] }, { id: 'voice', type: 'audio', clipIds: ['voice'], gain: 0 }],
	});
	const runtime = projectForRuntimeConsumers(project), buffers = new Map([
		['music', music as unknown as globalThis.AudioBuffer], ['voice', voice as unknown as globalThis.AudioBuffer],
	]);
	const engine = native.createEngine(); engine.loadProject(runtime, buffers);
	const expected = audioBufferChannels(await engine.renderMix({ startFrame: 12000, endFrame: 48000,
		includeMaster: false, includeTrackPan: false, includeTail: false, preRollFrames: 0 }))[0]!;
	await engine.dispose();
	assert.ok(expected.some(sample => sample > .2) && expected.some(sample => sample > 0 && sample < .1), 'the guide must cause real ducking');
	const input = runtime as unknown as ClipTransformProject;
	const measured = await renderClipNormalizationAudio({ createEngine: native.createEngine, sourceBuffers: buffers,
		sourceChunkProviders: new Map(), prepare: async () => {},
	}, input, input.clips[0]!, music, new AbortController().signal);
	assert.equal(measured.length, expected.length);
	const error = measured.getChannelData(0).reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - expected[frame]!)), 0);
	const different = expected.findIndex((sample, frame) => Math.abs(sample - measured.getChannelData(0)[frame]!) > 1e-6);
	assert.ok(error < 1e-6, `normalization must measure detector processing, error ${String(error)}, first ${String(different)}: ${String(expected[different])} / ${String(measured.getChannelData(0)[different])}`);
});
