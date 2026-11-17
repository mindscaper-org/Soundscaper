/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { fcpxmlSplitEdit } from './helpers/fcpxml-split-edit-fixture.ts';
import { parseFcpxmlTimeline } from '../src/common/editor/timeline-interchange-fcpxml-import.ts';

for (const host of ['asset-clip', 'clip', 'sync-clip'] as const) for (const [start, duration] of [[1, 4], [3, 1], [1, undefined]] as const) {
	test(`FCPXML ${host} split audio has its own extent, start=${String(start)}, duration=${String(duration)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		try {
			const channel = Float32Array.from({ length: 6 * 48000 }, (_, frame) => .1 + .01 * Math.floor(frame / 48000));
			await controller.actions.project.importFiles([
				new File([fcpxmlSplitEdit(host, start, duration)], 'Split.fcpxml', { type: 'application/xml' }),
				new File([Uint8Array.from(encodeWav([channel], { sampleRate: 48000, float: true }))], 'dialogue.wav', { type: 'audio/wav' }),
			]);
			const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 6 * 48000, includeTail: false }))[0]!;
			const end = start + (duration ?? 2);
			for (const second of [.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
				const expected = second >= start && second < end ? (.1 + .01 * Math.floor(second)) / Math.sqrt(2) : 0;
				assert.ok(Math.abs(pcm[second * 48000]! - expected) < .00001, `audio sample at ${String(second)} seconds: ${String(pcm[second * 48000])}, expected ${String(expected)}`);
			}
			const clip = controller.project?.clips[0]; assert.ok(clip);
			assert.equal(clip.timelineStartFrame, start * 48000);
			assert.equal(clip.sourceStartFrame, start * 48000);
			assert.equal(clip.durationFrames, (duration ?? 2) * 48000);
		} finally { await controller.dispose(); await native.dispose(); }
	});
}

for (const host of ['asset-clip', 'clip', 'sync-clip'] as const) test(`FCPXML ${host} split audio retains the picture edit`, () => {
	const document = parseFcpxmlTimeline(fcpxmlSplitEdit(host, 1, 4, true));
	const video = document.tracks.find(track => track.kind === 'video')!.clips[0]!;
	const audio = document.tracks.find(track => track.kind === 'audio')!.clips[0]!;
	assert.deepEqual(video.start, { num: 2, den: 1 }); assert.deepEqual(video.duration, { num: 2, den: 1 });
	assert.deepEqual(video.sourceStart, { num: 2, den: 1 });
	assert.deepEqual(audio.start, { num: 1, den: 1 }); assert.deepEqual(audio.duration, { num: 4, den: 1 });
	assert.deepEqual(audio.sourceStart, { num: 1, den: 1 });
});
