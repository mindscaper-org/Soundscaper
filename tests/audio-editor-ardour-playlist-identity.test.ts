/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { ardourPlaylistIdentitySession } from './helpers/ardour-playlist-identity-fixture.ts';

for (const legacy of [false, true]) for (const collision of [false, true]) {
	test(`Ardour File Import distinguishes playlist IDs and names, legacy=${String(legacy)}, collision=${String(collision)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		const channel = new Float32Array(4800); channel.fill(.125, 0, 2400); channel.fill(.375, 2400);
		try {
			await controller.actions.project.importFiles([
				new File([ardourPlaylistIdentitySession(legacy, collision)], 'Playlist.ardour', { type: 'application/xml' }),
				new File([Uint8Array.from(encodeWav([channel], { sampleRate: 48000, float: true }))], 'voice.wav', { type: 'audio/wav' }),
			]);
			assert.equal(controller.project?.clips[0]?.title, 'Programme');
			const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 2400, includeTail: false }))[0]!;
			assert.ok(Math.abs(pcm[1200]! - .125 / Math.sqrt(2)) < .00001, 'active playlist media must be selected by the native reference namespace');
		} finally { await controller.dispose(); await native.dispose(); }
	});
}
