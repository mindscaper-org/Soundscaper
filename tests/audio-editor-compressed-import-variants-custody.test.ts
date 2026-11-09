/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';
import { repeatedVorbisCommentsFixture } from './helpers/repeated-vorbis-comments-fixture.ts';
import { createPaddedMetadataWavPackFixture } from './helpers/wavpack-import-fixture.ts';
import { vorbisTimestampFixture, vorbisTimestampReference } from './helpers/vorbis-timestamp-fixture.ts';
import { vorbisMissingGranuleFixture } from './helpers/vorbis-missing-granule-fixture.ts';
import { crcOffsetMp3Fixture, apePreviewMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';
import { multiplexedOpusFixture, croppedOpusGranuleFixture } from './helpers/ogg-multiplexed-tail-fixture.ts';

for (const format of ['flac', 'ogg-vorbis', 'opus'] as const) test(`${format} repeated credits retain real decoded PCM through independent Scape reopening`, async context => {
	const result = await imported(context, await repeatedVorbisCommentsFixture(format));
	assertFormat(result, 48_000, 4800, 1);
	assert.deepEqual(result.contribution.warnings, []);
	assert.equal(result.contribution.metadata.normalized.artist, 'Ada; Grace; Ada');
	assert.deepEqual(result.contribution.metadata.raw.ARTIST, { 0: 'Ada', 1: 'Grace', 2: 'Ada' });
	assert.deepEqual(result.contribution.metadata.raw.PERFORMER, { 0: 'First chair', 1: 'Second chair' });
	assert.equal(result.contribution.metadata.normalized.trackNumber, 2);
	// The authored source is .15*sin(frame*.04), not a memory-engine placeholder.
	const channel = result.channels[0]!;
	const rms = Math.sqrt(channel.slice(500, 4300).reduce((sum, sample) => sum + sample ** 2, 0) / 3800);
	assert.ok(rms > .08 && rms < .13);
	let crossings = 0;
	for (let frame = 501; frame < 4300; frame++) if (channel[frame - 1]! <= 0 && channel[frame]! > 0) crossings++;
	assert.ok(Math.abs(crossings - 3800 * .04 / (2 * Math.PI)) <= 1);
});

for (const [padding, retainTag] of [[0, true], [16, true], [4096, true], [4096, false]] as const) {
	test(`WavPack padding${padding} tag${retainTag} retains actual WASM-decoded PCM and metadata through Scape`, async context => {
		const result = await imported(context, await createPaddedMetadataWavPackFixture(padding, retainTag), true);
		assertFormat(result, 48_000, 4800, 2);
		assert.deepEqual(result.contribution.warnings, []);
		assert.equal(result.contribution.metadata.normalized.title, retainTag ? 'Shorter edited metadata' : undefined);
		assertNearChannels(result.channels, [
			Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(frame * .1) * .2),
			Float32Array.from({ length: 4800 }, (_, frame) => Math.cos(frame * .03) * .1),
		], 1e-7);
	});
}

for (const [absolute, missingPages] of [[false, 0], [true, 0], [false, Infinity], [true, 2]] as const) {
	test(`Vorbis origin${absolute} missing${missingPages} retains literal extent and independent reference PCM through Scape`, async context => {
		const file = missingPages ? await vorbisMissingGranuleFixture(absolute, missingPages) : vorbisTimestampFixture(absolute);
		const result = await imported(context, file);
		assertFormat(result, 48_000, 4800, 2);
		assertNearChannels(result.channels, vorbisTimestampReference(), 1e-6);
	});
}

for (const [header, legacy] of [[true, false], [false, true]] as const) test(`MP3 APE header${header} legacy${legacy} retains only programme PCM through Scape`, async context => {
	useLocalAudioCodecPayloads(context);
	const options = { codecRuntime: createReviewedAudioCodecRuntime() };
	const control = await importAndReopenAudio(context, await crcOffsetMp3Fixture('unprotected'), options);
	const result = await importAndReopenAudio(context, await apePreviewMp3Fixture(header, legacy), options);
	assertFormat(result, 48_000, 4800, 1);
	assertNearChannels(result.channels, control.channels, 1e-8);
	assertTone(result.channels[0]!, .03, .1, .17);
});

for (const kind of ['multiplexed', 'cropped'] as const) test(`Opus ${kind} stream retains primary programme extent through Scape`, async context => {
	useLocalAudioCodecPayloads(context);
	const options = { codecRuntime: createReviewedAudioCodecRuntime() };
	const fixture = kind === 'multiplexed' ? await multiplexedOpusFixture() : await croppedOpusGranuleFixture();
	const controlBytes = 'primary' in fixture ? fixture.primary : fixture.original;
	const variantBytes = 'multiplexed' in fixture ? fixture.multiplexed : fixture.cropped;
	const control = await importAndReopenAudio(context, new File([controlBytes], 'Primary.opus', { type: 'audio/ogg' }), options);
	const result = await importAndReopenAudio(context, new File([variantBytes], `${kind}.opus`, { type: 'audio/ogg' }), options);
	assertFormat(result, 48_000, 48_001, 1);
	assertNearChannels(result.channels, control.channels, 1e-8);
	assertTone(result.channels[0]!, .03, .05, .09);
});

async function imported(context: TestContext, file: File, wavpackWorkerTransport = false) {
	useLocalAudioCodecPayloads(context, { wavpackWorkerTransport });
	// The helper rejects native decoder fallback: only shipping real WASM may decode.
	return importAndReopenAudio(context, file, { codecRuntime: createReviewedAudioCodecRuntime() });
}

function assertFormat(result: Awaited<ReturnType<typeof imported>>, sampleRate: number, frameCount: number, channelCount: number): void {
	assert.equal(result.source.sampleRate, sampleRate);
	assert.equal(result.source.frameCount, frameCount);
	assert.equal(result.source.channelCount, channelCount);
	assert.equal(result.channels.length, channelCount);
	for (const channel of result.channels) assert.equal(channel.length, frameCount);
}

function assertNearChannels(actual: readonly Float32Array[], expected: readonly Float32Array[], tolerance: number): void {
	assert.equal(actual.length, expected.length);
	for (const [channel, reference] of expected.entries()) {
		const values = actual[channel]; assert.ok(values);
		assert.equal(values.length, reference.length);
		for (const [frame, value] of reference.entries()) {
			assert.ok(Math.abs(values[frame]! - value) < tolerance, `channel${channel} frame${frame}: ${values[frame]} must match ${value}`);
		}
	}
}

function assertTone(channel: Float32Array, radiansPerFrame: number, minimumRms: number, maximumRms: number): void {
	const first = 500, end = channel.length - 500, frames = end - first;
	let energy = 0, crossings = 0;
	for (let frame = first; frame < end; frame++) {
		energy += channel[frame]! ** 2;
		if (frame > first && channel[frame - 1]! <= 0 && channel[frame]! > 0) crossings++;
	}
	const rms = Math.sqrt(energy / frames);
	assert.ok(rms > minimumRms && rms < maximumRms, `independent authored programme RMS ${rms}`);
	assert.ok(Math.abs(crossings - frames * radiansPerFrame / (2 * Math.PI)) <= 1, 'independent authored programme frequency');
}
