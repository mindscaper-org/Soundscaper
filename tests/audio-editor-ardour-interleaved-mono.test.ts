/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { ardourInterleavedMonoSession } from './helpers/ardour-interleaved-mono-fixture.ts';

for (const withStereo of [false, true]) test(`Ardour mono region uses only its interleaved source channel, stereo neighbour=${String(withStereo)}`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
	const wave = encodeWav([new Float32Array(4800).fill(.125), new Float32Array(4800).fill(.375)], { sampleRate: 48000, float: true });
	try {
		await controller.actions.project.importFiles([
			new File([ardourInterleavedMonoSession(withStereo)], 'Channels.ardour', { type: 'application/xml' }),
			new File([Uint8Array.from(wave)], 'stereo.wav', { type: 'audio/wav' }),
		]);
		const project = controller.project; assert.ok(project);
		const output = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
		assert.ok(Math.abs(output[0]![1000]! - (withStereo ? .625 : .125)) < .00001,
			`the mono view must never replay the right source channel (sample: ${String(output[0]![1000])})`);
		const clips = project.clips as readonly { sourceId: string }[];
		const sources = project.sources as readonly { id: string; channelCount: number }[];
		assert.equal(sources.find(source => source.id === clips[0]!.sourceId)?.channelCount, 1);
		if (withStereo) {
			assert.notEqual(clips[0]!.sourceId, clips[1]!.sourceId, 'mono and stereo views must not share incompatible source geometry');
			assert.equal(sources.find(source => source.id === clips[1]!.sourceId)?.channelCount, 2);
		}
	} finally { await controller.dispose(); await native.dispose(); }
});
