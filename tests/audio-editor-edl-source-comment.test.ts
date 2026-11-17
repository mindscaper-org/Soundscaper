/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { edlSourceComments } from './helpers/edl-source-comment-fixture.ts';
import { parseEdlTimeline } from '../src/common/editor/timeline-interchange-edl-import.ts';

for (const fileFirst of [false, true]) for (const keyword of ['SOURCE FILE', 'FROM FILE'] as const) {
	test(`EDL File Import retains ${keyword} companion binding before clip name=${String(fileFirst)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		try {
			await controller.actions.project.importFiles([
				new File([edlSourceComments(fileFirst, keyword)], 'Programme.edl', { type: 'text/plain' }),
				new File([Uint8Array.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }))], 'Actual.wav', { type: 'audio/wav' }),
			]);
			const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 48000, includeTail: false }))[0]!;
			assert.ok(Math.abs(pcm[24000]! - .25 / Math.sqrt(2)) < .00001, 'the referenced companion must remain decoded and audible');
			assert.equal(controller.project?.clips[0]?.title, 'Dialogue edit.NEW.01');
		} finally { await controller.dispose(); await native.dispose(); }
	});
}

test('EDL paired picture and sound retain the explicit source path and their display name', () => {
	const document = parseEdlTimeline(edlSourceComments(true, 'SOURCE FILE').replace('AX A C', 'AX AA/V C'));
	assert.deepEqual(document.media.map(media => media.path), ['media/Actual.wav', 'media/Actual.wav']);
	assert.deepEqual(document.tracks.flatMap(track => track.clips.map(clip => clip.name)), ['Dialogue edit.NEW.01', 'Dialogue edit.NEW.01']);
});

test('EDL without a source-file comment still uses the clip name as its media hint', () => {
	const document = parseEdlTimeline(edlSourceComments(true, 'SOURCE FILE').replace('* SOURCE FILE: media/Actual.wav\n', ''));
	assert.equal(document.media[0]?.path, 'Dialogue edit.NEW.01');
});
