/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBuffer } from 'node-web-audio-api';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';

for (const scope of ['clip', 'track'] as const) test(`flat ${scope} EQ preserves a mono clip's stereo reverb output`, async context => {
	const factory = createNodeWebAudioEngineFactory(context);
	const buffer = new AudioBuffer({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
	buffer.getChannelData(0)[0] = 1;
	const outputs: Float32Array[][] = [];
	for (const enabled of [false, true]) {
		const engine = factory.createEngine();
		const reverb = createEffect('reverb', { params: { mix: 1, duration: .05 } });
		const eq = enabled ? [createEffect('eq', { params: { bands: [], outputGain: 0 } })] : [];
		const project = createSoundscaperProject({ sampleRate: 48000,
			sources: [{ id: 'source', sampleRate: 48000, channelCount: 1, frameCount: 4800 }],
			clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effects: [reverb, ...scope === 'clip' ? eq : []] }],
			tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'], effects: scope === 'track' ? eq : [] }],
		});
		engine.loadProject(projectForRuntimeConsumers(project), new Map([['source', buffer as unknown as globalThis.AudioBuffer]]));
		outputs.push(audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false })).map(channel => channel.slice()));
		await engine.dispose();
	}
	assert.ok(outputs[0]![0]!.some((sample, frame) => Math.abs(sample - outputs[0]![1]![frame]!) > .001), 'the reference must contain an actual stereo tail');
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) {
		assert.ok(Math.abs(outputs[0]![channel]![frame]! - outputs[1]![channel]![frame]!) < 1e-6,
			`flat EQ must retain channel ${channel} at frame ${frame}`);
	}
});
