/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { omfPhysicalChannelBytes, omfPhysicalChannelWave } from './helpers/omf-physical-channel-fixture.ts';

for (const channels of [[1], [2], [1, 2]]) for (const embedded of [false, true]) {
	test(`OMF File Import retains physical channels ${channels.join(',')}, embedded=${String(embedded)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		try {
			await controller.actions.project.importFiles([new File([Uint8Array.from(omfPhysicalChannelBytes(channels, embedded))], 'Channels.omf'),
				...embedded ? [] : [new File([omfPhysicalChannelWave()], 'Stereo.wav', { type: 'audio/wav' })]]);
			const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
			const expected = channels.reduce((value, channel) => value + (channel === 1 ? .125 : .375), 0) * Math.SQRT1_2;
			for (const channel of pcm) assert.ok(Math.abs(channel[1200]! - expected) < .00001,
				`selected mono source must render ${String(expected)}, received ${String(channel[1200])}`);
			assert.equal(controller.project?.sources.length, channels.length);
			assert.ok(controller.project?.sources.every(source => source.channelCount === 1));
		} finally { await controller.dispose(); await native.dispose(); }
	});
}

for (const embedded of [false, true]) test(`OMF stereo Sound slots retain both channels, embedded=${String(embedded)}`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
	try {
		await controller.actions.project.importFiles([new File([Uint8Array.from(omfPhysicalChannelBytes([1], embedded, true))], 'Stereo.omf'),
			...embedded ? [] : [new File([omfPhysicalChannelWave()], 'Stereo.wav', { type: 'audio/wav' })]]);
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
		assert.ok(Math.abs(pcm[0]![1200]! - .125) < .00001);
		assert.ok(Math.abs(pcm[1]![1200]! - .375) < .00001);
		assert.equal(controller.project?.sources[0]?.channelCount, 2);
	} finally { await controller.dispose(); await native.dispose(); }
});
