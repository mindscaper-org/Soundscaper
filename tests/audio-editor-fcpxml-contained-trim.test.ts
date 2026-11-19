/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { fcpxmlContainedTrim, fcpxmlTrimDocument } from './helpers/fcpxml-contained-trim-fixture.ts';
import { parseFcpxmlTimeline } from '../src/common/editor/timeline-interchange-fcpxml-import.ts';

for (const container of ['clip', 'sync-clip'] as const) for (const trimHead of [false, true]) {
	test(`FCPXML File Import keeps contained audio inside its ${container} trim, head=${String(trimHead)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		const channel = Float32Array.from({ length: 6 * 48000 }, (_, frame) => .1 + .01 * Math.floor(frame / 48000));
		try {
			await controller.actions.project.importFiles([
				new File([fcpxmlContainedTrim(container, trimHead)], 'Trim.fcpxml', { type: 'application/xml' }),
				new File([Uint8Array.from(encodeWav([channel], { sampleRate: 48000, float: true }))], 'dialogue.wav', { type: 'audio/wav' }),
			]);
			assert.equal(controller.project?.clips.length, 1, 'the trimmed container must import successfully');
			const clip = controller.project!.clips[0]!;
			const output = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 3 * 48000, includeTail: false }))[0]!;
			assert.ok(Math.abs(output[24000]! - (trimHead ? .12 : .1) / Math.sqrt(2)) < .00001, 'contained source trim must reach the mixer');
			assert.ok(Math.abs(output[120000]!) < .00001, 'audio after the container out point must remain silent');
			assert.equal(clip.timelineStartFrame, 0);
			assert.equal(clip.durationFrames, 96000);
			assert.equal(clip.sourceStartFrame, trimHead ? 96000 : 0);
		} finally { await controller.dispose(); await native.dispose(); }
	});
}

test('FCPXML connected audio can outlive its immediate anchor', () => {
	const document = parseFcpxmlTimeline(fcpxmlTrimDocument('<clip offset="0s" start="0s" duration="1s"><audio lane="-1" ref="a" offset="0s" start="0s" duration="3s"/></clip>'));
	assert.deepEqual(document.tracks[0]!.clips[0]!.duration, { num: 3, den: 1 });
});

test('FCPXML a containing ancestor limits audio anchored to its contained child', () => {
	const document = parseFcpxmlTimeline(fcpxmlTrimDocument('<clip offset="0s" start="1s" duration="1s"><clip offset="0s" start="0s" duration="3s"><audio lane="-1" ref="a" offset="0s" start="0s" duration="6s"/></clip></clip>'));
	const clip = document.tracks[0]!.clips[0]!;
	assert.deepEqual(clip.start, { num: 0, den: 1 });
	assert.deepEqual(clip.duration, { num: 1, den: 1 });
	assert.deepEqual(clip.sourceStart, { num: 1, den: 1 });
});

test('FCPXML contained audio outside the visible parent range does not create an audible cut', () => {
	const document = parseFcpxmlTimeline(fcpxmlTrimDocument('<clip offset="0s" start="0s" duration="1s"><audio ref="a" offset="2s" start="0s" duration="1s"/></clip>'));
	assert.equal(document.tracks.flatMap(track => track.clips).length, 0);
});
