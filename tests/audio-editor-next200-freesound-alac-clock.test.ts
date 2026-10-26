/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { alacM4a48_000Fixture, aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

test('Freesound conversion pins the exact lossless ALAC clock before native decoding', async () => {
	const file = new File([Uint8Array.from(alacM4a48_000Fixture()).buffer], 'lossless.m4a');
	const decoded = { length: 4800, numberOfChannels: 2, sampleRate: 48_000,
		getChannelData: () => new Float32Array(4800).fill(.25) } as unknown as AudioBuffer;
	let closed = false;
	let requestedRate: number | undefined;
	const result = await prepareFreesoundUploadFile(file, undefined, { createDecodeContext: options => {
		requestedRate = options.sampleRate;
		return { decodeAudioData: async () => decoded, close: async () => { closed = true; } };
	} });
	assert.equal(requestedRate, 48_000, 'a 44.1 kHz device must not resample the lossless recording');
	assert.ok(closed);
	const actual = await inspectWavBlobPcm(result);
	assert.equal(actual.sampleRate, 48_000);
	assert.equal(actual.frameCount, 4800);
	assert.equal(actual.channelCount, 2);
});

test('decoded-clock inspection retains conservative admission for AAC and malformed ALAC cookies', () => {
	assert.equal(inspectDecodedAudioSampleRate(aacLcM4a48_000Fixture()), null);
	const original = Buffer.from(alacM4a48_000Fixture());
	assert.equal(inspectDecodedAudioSampleRate(original), 48_000);
	const cookie = original.indexOf('alac', original.indexOf('alac') + 1);
	for (const field of ['rate', 'channels', 'depth', 'version', 'frames'] as const) {
		const bytes = Buffer.from(original);
		if (field === 'rate') bytes.writeUInt32BE(44_100, cookie + 28);
		if (field === 'channels') bytes[cookie + 17] = 1;
		if (field === 'depth') bytes[cookie + 13] = 7;
		if (field === 'version') bytes[cookie + 12] = 1;
		if (field === 'frames') bytes.writeUInt32BE(0xffff_ffff, cookie + 8);
		assert.equal(inspectDecodedAudioSampleRate(bytes), null, field);
	}
});

test('an ambiguous multi-audio presentation cannot pin the decode clock', () => {
	const bytes = Buffer.from(alacM4a48_000Fixture());
	const movie = bytes.indexOf('moov') - 4, movieEnd = movie + bytes.readUInt32BE(movie);
	const track = bytes.indexOf('trak', movie) - 4, trackEnd = track + bytes.readUInt32BE(track);
	const duplicate = Buffer.concat([bytes.subarray(0, movieEnd), bytes.subarray(track, trackEnd), bytes.subarray(movieEnd)]);
	duplicate.writeUInt32BE(bytes.readUInt32BE(movie) + trackEnd - track, movie);
	assert.equal(inspectDecodedAudioSampleRate(duplicate), null);
});
