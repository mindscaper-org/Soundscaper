/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isStreamedAudioImportFile } from '../src/common/editor/streamed-audio-import-file.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { AUDIO_IMPORT_FORMATS, encodedAudioImportFixture, extendedWaveImportFixture, waveAliasImportFixture } from './helpers/audio-format-import-cases.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';

for (const [label, extension, codec, mimeType] of AUDIO_IMPORT_FORMATS.filter(([, extension]) => extension !== 'aac' && extension !== 'm4a')) {
	test(`${label} actual decoder retains stereo PCM through controller import and independent Scape reopening`, async context => {
		const input = await encodedAudioImportFixture(extension, codec, mimeType);
		useLocalAudioCodecPayloads(context, { wavpackWorkerTransport: true });
		const file = new File([input.buffer], input.name, { type: input.mimeType });
		assert.equal(isStreamedAudioImportFile(file), !['aiff', 'aif', 'aifc'].includes(extension));
		const { project, source, channels } = await importAndReopenAudio(context, file, { codecRuntime: createReviewedAudioCodecRuntime() });
		assert.equal(source.sampleRate, 48_000);
		assert.equal(source.channelCount, 2);
		assert.ok(source.frameCount >= 48_000 && source.frameCount <= 51_200, `authored one-second extent: ${source.frameCount}`);
		assert.equal(project.clips[0]?.durationFrames, source.frameCount);
		assert.equal(channels.length, 2);
		for (const [index, channel] of channels.entries()) {
			assert.equal(channel.length, source.frameCount);
			const peak = channel.reduce((maximum, sample) => Math.max(maximum, sample), 0);
			const trough = channel.reduce((minimum, sample) => Math.min(minimum, sample), 0);
			assert.ok(peak > (index ? .05 : .2) && peak < (index ? .2 : .4));
			assert.ok(trough < (index ? -.05 : -.2));
			let crossings = 0;
			for (let frame = 4801; frame < 43_200; frame++) if (channel[frame - 1]! <= 0 && channel[frame]! > 0) crossings++;
			assert.ok(Math.abs(crossings / .8 - 330) <= 2, `channel ${index} preserves 330 Hz instead of a synthetic buffer`);
		}
		if (['flac', 'wv', 'wavpack', 'aiff', 'aif', 'aifc'].includes(extension)) {
			assert.equal(source.frameCount, 48_000);
			assertPcmChannelsEqual(channels, input.expectedPcm);
		}
	});
}

for (const fixture of [extendedWaveImportFixture('RF64'), extendedWaveImportFixture('BW64'), waveAliasImportFixture()]) {
	test(`${fixture.name} retains declared incremental PCM and aliases through independent Scape reopening`, async context => {
		const { source, channels } = await importAndReopenAudio(context, new File([fixture.buffer], fixture.name));
		assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 2);
		assert.equal(source.frameCount, fixture.expectedPcm[0]!.length);
		assertPcmChannelsEqual(channels, fixture.expectedPcm);
	});
}

test('an Ogg container MIME without a filename suffix retains actual decoded stereo PCM', async context => {
	const input = await encodedAudioImportFixture('ogg', 'libvorbis', 'application/ogg');
	useLocalAudioCodecPayloads(context);
	const { source, channels } = await importAndReopenAudio(context,
		new File([input.buffer], 'downloaded-original', { type: 'application/ogg' }), { codecRuntime: createReviewedAudioCodecRuntime() });
	assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 2);
	assert.equal(channels[0]?.length, source.frameCount);
	assert.ok(channels[0]!.some(value => value > .2));
	assert.ok(channels[1]!.some(value => value > .05));
});
