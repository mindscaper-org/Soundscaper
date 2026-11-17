/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { aafMultipleDescriptorBytes } from './helpers/aaf-multiple-descriptor-fixture.ts';

for (const reverse of [false, true]) for (const repeated of [false, true]) test(`AAF File Import retains each MultipleDescriptor WAV, reverse=${String(reverse)}, repeated=${String(repeated)}`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
	try {
		await controller.actions.project.importFiles([new File([Uint8Array.from(aafMultipleDescriptorBytes(reverse, repeated))], 'Linked.aaf'),
			...(['First.wav', 'Second.wav'] as const).map((name, index) => new File([encodeWav([new Float32Array(4800).fill(index ? .375 : .125)],
				{ sampleRate: 48000, bitDepth: 16, dither: false })], name, { type: 'audio/wav' }))]);
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
		for (const channel of pcm) assert.ok(Math.abs(channel[1200]! - (repeated ? .25 : .5) * Math.SQRT1_2) < .00001,
			`different descriptors must play their own recordings, received ${String(channel[1200])}`);
		assert.equal(controller.project?.sources.length, repeated ? 1 : 2);
	} finally { await controller.dispose(); await native.dispose(); }
});
