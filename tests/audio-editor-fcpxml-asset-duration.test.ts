/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { fcpxmlAssetDurationDocument } from './helpers/fcpxml-contained-trim-fixture.ts';

for (const explicit of [false, true]) test(`FCPXML File Import resolves asset-clip duration, explicit=${String(explicit)}`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
	try {
		await controller.actions.project.importFiles([
			new File([fcpxmlAssetDurationDocument(explicit)], 'Whole asset.fcpxml', { type: 'application/xml' }),
			new File([Uint8Array.from(encodeWav([new Float32Array(6 * 48000).fill(.25)], { sampleRate: 48000, float: true }))], 'dialogue.wav', { type: 'audio/wav' }),
		]);
		assert.equal(controller.project?.clips[0]?.durationFrames, 6 * 48000);
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 6 * 48000, includeTail: false }))[0]!;
		assert.ok(Math.abs(pcm[5 * 48000]! - .25 / Math.sqrt(2)) < .00001, 'the implicit duration must reach actual audio delivery');
	} finally { await controller.dispose(); await native.dispose(); }
});
