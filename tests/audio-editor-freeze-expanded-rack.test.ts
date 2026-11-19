/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { planFreezeRange, renderFreezeBody } from '../src/soundscaper/editor-audio-track-freeze-render.ts';

test('freeze cannot silently collapse the stereo image of a mono clip reverb', async context => {
	const store = createMemoryProjectStore(context, 'freeze-expanded-rack'), factory = createNodeWebAudioEngineFactory(context);
	const input = new Float32Array(4800); input[0] = .8;
	const writer = await store.beginSourceWrite('source', { sampleRate: 48000, channelCount: 1 });
	await writer.write([input]); await writer.commit();
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48000, channelCount: 1, frameCount: 4800 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effects: [createEffect('reverb', { params: { mix: 1, duration: .05 } })] }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], effects: [createEffect('delay', { params: { time: .025, mix: 0 } })] }],
	});
	const engine = factory.createEngine(), buffer = new AudioBuffer({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
	buffer.getChannelData(0).set(input);
	engine.loadProject(projectForRuntimeConsumers(project), new Map([['source', buffer as unknown as globalThis.AudioBuffer]]));
	const live = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
	assert.ok(live[0]!.some((sample, frame) => Math.abs(sample - live[1]![frame]!) > .001), 'the shipping mixer produces distinct stereo channels');
	await engine.dispose();
	assert.throws(() => planFreezeRange(project, 'voice'), /channel widths/iu);
	await assert.rejects(renderFreezeBody(store, { project }, () => factory.createEngine(), {
		project, trackId: 'voice', sampleRate: 48000, renderStartFrame: 0, renderFrameCount: 7200,
	}), /channel widths/iu);
});

for (const stereo of [false, true]) test(`freeze still admits ${stereo ? 'stereo sources' : 'bypassed stereo reverb'}`, () => {
	const project = createSoundscaperProject({ sources: [{ id: 'source', channelCount: stereo ? 2 : 1, sampleRate: 48000, frameCount: 4800 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effectsActive: stereo,
			effects: [createEffect('reverb', { params: { duration: .05 } })] }], tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }] });
	assert.ok(planFreezeRange(project, 'voice').renderFrameCount >= 4800);
});
