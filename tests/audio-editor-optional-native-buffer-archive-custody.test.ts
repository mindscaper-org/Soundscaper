/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { lowClockPcmFixture } from './helpers/low-clock-pcm-fixture.ts';
import { audioProject, optionalPcmCacheSession } from './helpers/optional-pcm-cache-custody.ts';

for (const sampleRate of [48_000, 768_000] as const) test(`${sampleRate} Hz import and channel publication preserve every original integer PCM sample through fresh Scape`, async context => {
	const { controller, store } = await optionalPcmCacheSession(context);
	const frequencies = sampleRate === 768_000 ? [440, 880] : [440];
	const channels = frequencies.map(frequency => Float32Array.from({ length: sampleRate }, (_value, frame) => .5 * Math.sin(2 * Math.PI * frequency * frame / sampleRate)));
	const bytes = Uint8Array.from(encodeWav(channels, { sampleRate, bitDepth: 24, dither: false }));
	// Independent integer-PCM expectation, including the authored quantization rather than a decoded substitute.
	const expected = channels.map(channel => Float32Array.from(channel, sample => {
		const integer = Math.round(sample * 8_388_608); return integer === 0 ? 0 : integer / 8_388_608;
	}));
	await controller.actions.project.importFiles([new File([bytes], 'High rate.wav', { type: 'audio/wav' })]);
	const original = audioProject(structuredClone(controller.project));
	assert.equal(original.sampleRate, 48_000); assert.equal(original.clips.length, 1);
	const source = original.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, sampleRate); assert.equal(source.frameCount, sampleRate);
	assert.equal(source.channelCount, channels.length); assert.equal(original.clips[0]?.durationFrames, 48_000);
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, controller.project, (_name, actual) => {
		assert.equal(actual.length, expected.length);
		for (const [channel, pcm] of actual.entries()) assertPcmSamplesEqual(pcm, expected[channel]!);
	});
	if (sampleRate === 48_000) return;
	const track = original.tracks[0]; assert.ok(track);
	await controller.actions.track.splitStereoLR(track.id);
	const split = audioProject(structuredClone(controller.project));
	assert.equal(split.clips.length, 2); assert.equal(split.tracks.length, 2);
	assert.deepEqual(split.tracks.map(value => value.pan), [-1, 1]);
	for (const [index, derivedTrack] of split.tracks.entries()) {
		const ids = derivedTrack.clipIds; assert.ok(Array.isArray(ids)); assert.equal(ids.length, 1);
		const clip = split.clips.find(value => value.id === ids[0]); assert.ok(clip?.kind === 'audio');
		assert.equal(clip.durationFrames, 48_000); assert.equal(clip.sourceDurationFrames, 768_000);
		const derived = split.sources.find(value => value.id === clip.sourceId); assert.ok(derived?.kind === 'audio');
		assert.equal(derived.sampleRate, 768_000); assert.equal(derived.frameCount, 768_000); assert.equal(derived.channelCount, 1);
		assert.ok(derived.name.endsWith(index ? 'Right' : 'Left'));
	}
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, original.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, split.clips);
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, controller.project, (name, actual) => {
		if (actual.length === 2) {
			for (const [channel, pcm] of actual.entries()) assertPcmSamplesEqual(pcm, expected[channel]!);
		} else { assert.equal(actual.length, 1); assertPcmSamplesEqual(actual[0], expected[name.endsWith('Right') ? 1 : 0]!); }
	});
});

for (const rate of [1_000, 48_000] as const) test(`Source Monitor Invert retains every independently authored ${rate} Hz sample through history and fresh Scape`, async context => {
	const { controller, store } = await optionalPcmCacheSession(context);
	const { file, channel } = lowClockPcmFixture(rate);
	await controller.actions.project.importFiles([file]);
	const original = audioProject(structuredClone(controller.project));
	const clip = original.clips[0], source = original.sources[0]; assert.ok(clip?.kind === 'audio'); assert.ok(source?.kind === 'audio');
	assert.equal(original.sampleRate, 48_000); assert.equal(source.sampleRate, rate); assert.equal(source.frameCount, rate);
	assert.equal(clip.durationFrames, 48_000); assert.equal(clip.sourceDurationFrames, rate);
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, original, (_name, channels) => {
		assert.equal(channels.length, 1); assertPcmSamplesEqual(channels[0], channel);
	});
	controller.actions.effects.setSourceSelection({ clipId: clip.id, startFrame: 0, endFrame: rate });
	await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });
	const inverted = audioProject(structuredClone(controller.project));
	const updated = inverted.clips[0]; assert.ok(updated?.kind === 'audio'); assert.notEqual(updated.sourceId, source.id);
	const result = inverted.sources.find(value => value.id === updated.sourceId); assert.ok(result?.kind === 'audio');
	assert.equal(result.sampleRate, rate); assert.equal(result.frameCount, rate); assert.equal(result.channelCount, 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, original.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, inverted.clips);
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
		assert.equal(channels.length, 1);
		assertPcmSamplesEqual(channels[0], name === result.name ? Float32Array.from(channel, sample => -sample) : channel);
	});
});
