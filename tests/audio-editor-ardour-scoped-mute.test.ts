/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { ardourScopedMuteSession } from './helpers/ardour-scoped-mute-fixture.ts';

const scopes = Array.from({ length: 8 }, (_, mask) => ['Main', 'PreFader', 'PostFader'].filter((_, bit) => mask & 1 << bit));
const profiles = [
	...scopes.flatMap(points => [false, true].flatMap(muted => [false, true].map(post => ({ points, muted, post, automated: false, active: true })))),
	...[['Main'], ['PreFader'], ['Main', 'PreFader']].flatMap(points => [false, true].map(post => ({ points, muted: false, post, automated: true, active: true }))),
	...[false, true].map(post => ({ points: ['Main'], muted: false, post, automated: false, active: false })),
];
for (const { points, muted, post, automated, active } of profiles) test(`Ardour File Import retains scoped mute [${points.join(',')}], muted=${String(muted)}, post=${String(post)}, automated=${String(automated)}, active=${String(active)}`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
	try {
		await controller.actions.project.importFiles([
			new File([ardourScopedMuteSession(points, muted, post, automated, active)], 'Scoped mute.ardour', { type: 'application/xml' }),
			new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.125), new Float32Array(4800)], { sampleRate: 48000, float: true }))], 'voice.wav', { type: 'audio/wav' }),
		]);
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }))[0]!;
		for (const frame of [1200, 3600]) {
			const mute = automated ? frame >= 2400 : muted;
			const main = mute && points.includes('Main') ? 0 : .125;
			const cue = mute && points.includes(post ? 'PostFader' : 'PreFader') ? 0 : .0625;
			const expected = active ? main + cue : 0;
			assert.ok(Math.abs(pcm[frame]! - expected) < .00001, `sample ${String(frame)}: ${String(pcm[frame])} must equal ${String(expected)}`);
		}
	} finally { await controller.dispose(); await native.dispose(); }
});
