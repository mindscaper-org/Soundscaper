/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { floatWave } from './helpers/float32-wave-fixture.ts';
import { createExternalMediaAudioDecoder } from '../src/common/editor/controller/import/internal/external-media-audio-decoder.ts';
import { attachExternalMedia } from '../src/common/editor/desktop-external-media.ts';
import { enabledVideoAudioTrackFixture } from './helpers/native-video-audio-tail-fixture.ts';
import { sourceMonitorFragmentedMedia } from './browser/fixtures/video-timing-probe-media.js';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';

const samples = new Float32Array([0.25, -0.5, 0.75, 0]);
const source = { kind: 'audio', id: 'audio', name: 'source.wav', sampleRate: 48_000, channelCount: 1, frameCount: 4, chunkFrames: 4 };
const refuse = async (): Promise<never> => { throw new Error('Unexpected codec decode.'); };

test('external WAV audio rebuilds the exact samples using the maintained PCM reader', async () => {
	const decode = createExternalMediaAudioDecoder({ decodeNative: refuse, decodeCodec: refuse });
	const file = new Blob([new Uint8Array(floatWave(48_000, 1, new Uint8Array(samples.buffer)))]);
	assert.deepEqual(await decode(file, source), [samples]);
	await assert.rejects(decode(file, { ...source, sampleRate: 44_100 }), /does not match/u);
	await assert.rejects(decode(file, { ...source, frameCount: 8 }), /does not match/u);
});

test('containers rejected by the PCM reader can reopen through the desktop codec', async () => {
	const wave = floatWave(48_000, 1, new Uint8Array(samples.buffer));
	new DataView(wave.buffer).setUint16(20, 6, true);
	const file = new Blob([new Uint8Array(wave)]);
	let calls = 0;
	const decode = createExternalMediaAudioDecoder({ decodeNative: refuse, decodeCodec: async (input, settings) => {
		assert.equal(input, file); assert.equal(settings.sampleRate, 48_000); calls += 1;
		return { channels: [samples], sampleRate: 48_000 };
	} });
	assert.deepEqual(await decode(file, source), [samples]);
	assert.equal(calls, 1);
});

test('video companion audio retains import padding and cancellation', async () => {
	const file = new Blob(['video']);
	const videoAudio = attachExternalMedia(source, { reference: 'video-original', byteLength: file.size,
		sha256: 'a'.repeat(64) }, 'video-audio');
	const decode = createExternalMediaAudioDecoder({ decodeCodec: refuse, decodeNative: async (_bytes, rate) => {
		assert.equal(rate, null);
		return { channels: [samples.subarray(0, 2)], sampleRate: 48_000 };
	} });
	assert.deepEqual(await decode(file, videoAudio), [new Float32Array([0.25, -0.5, 0, 0])]);
	await assert.rejects(decode(file, videoAudio, AbortSignal.abort()), (error: unknown) => error instanceof Error && error.name === 'AbortError');
});

test('video companion audio reuses its original native decode rate on another output device', async () => {
	const file = new Blob(['video']);
	const videoAudio = attachExternalMedia(source, { reference: 'video-original', byteLength: file.size,
		sha256: 'a'.repeat(64), decodeSampleRate: 44_100 }, 'video-audio');
	const decode = createExternalMediaAudioDecoder({ decodeCodec: refuse, decodeNative: async (_bytes, rate) => {
		assert.equal(rate, 44_100);
		return { channels: [samples], sampleRate: 44_100 };
	} });
	const result = await decode(file, videoAudio);
	assert.equal(result[0]!.length, source.frameCount);
	assert.ok(result[0]!.every(Number.isFinite));
});

test('video companion recovery requires the recorded stream in both decode modes and keeps unmarked archives readable', async () => {
	const file = new Blob([enabledVideoAudioTrackFixture()], { type: 'video/mp4' });
	const videoAudio = attachExternalMedia({ ...source, opaqueExtensions: {} }, { reference: 'video-original', byteLength: file.size,
		sha256: 'a'.repeat(64) }, 'video-audio');
	let nativeCalls = 0;
	const decode = createExternalMediaAudioDecoder({ decodeCodec: refuse, async decodeNative() {
		nativeCalls++;
		return { channels: [samples], sampleRate: 48_000 };
	} });
	const wrongStream = { ...videoAudio, opaqueExtensions: { ...videoAudio.opaqueExtensions,
		videoAudioProgramme: { streamIndex: 1, pictureFrameCount: 4 },
	} };
	for (const mode of [undefined, { videoAudioTiming: 'import' as const }]) {
		await assert.rejects(decode(file, wrongStream, undefined, mode), /recorded container stream/u);
	}
	assert.equal(nativeCalls, 0);
	for (const mode of [undefined, { videoAudioTiming: 'import' as const }]) {
		assert.deepEqual(await decode(file, videoAudio, undefined, mode), [samples]);
	}
	assert.equal(nativeCalls, 2);
});

test('qualified hybrid AAC import and recorded recovery supply both packet runs and trim the exact authored end', async () => {
	const fixture = sourceMonitorFragmentedMedia()[2]!;
	const file = new Blob([Uint8Array.from(fixture.buffer)], { type: fixture.mimeType });
	const calls: number[] = [];
	const decodeNative = async (encoded: ArrayBuffer, sampleRate?: number | null) => {
		const input = new Input({ source: new BlobSource(new Blob([encoded])), formats: [MP4] });
		try {
			const audio = await input.getPrimaryAudioTrack();
			assert.ok(audio);
			let packets = 0;
			for await (const packet of new EncodedPacketSink(audio).packets()) {
				assert.equal(Math.round(packet.timestamp * 48_000), packets * 1024);
				packets++;
			}
			const pictures = (await input.getVideoTracks()).length;
			calls.push(pictures);
			assert.equal(packets, pictures ? 12 : 46);
			if (!pictures) assert.equal(sampleRate, 48_000);
			return { channels: [new Float32Array(packets * 1024).fill(.25)], sampleRate: 48_000 };
		} finally { input.dispose(); }
	};
	const imported = await decodeImportedVideoAudio({
		file, projectSampleRate: 44_100, hasAudio: true, durationSeconds: 42_630 / 44_100,
		inspectEncodedSampleRate: () => null, decodeNative, decodeFfmpeg: refuse,
	});
	assert.equal(imported.selectedAudioStreamIndex, 1);
	assert.equal(imported.decodedAudio.channels?.[0]?.length, 46_144);
	const reference = {
		reference: 'video-original', byteLength: file.size, sha256: 'a'.repeat(64), decodeSampleRate: 48_000,
	};
	const shape = { ...source, frameCount: 46_400 };
	const legacy = attachExternalMedia(shape, reference, 'video-audio');
	const recorded = attachExternalMedia({ ...shape,
		opaqueExtensions: { videoAudioProgramme: { streamIndex: 1, pictureFrameCount: 46_400 } },
	}, reference, 'video-audio');
	const decodeExternal = createExternalMediaAudioDecoder({ decodeNative, decodeCodec: refuse });
	const expected = new Float32Array(46_400).fill(.25, 0, 46_144);
	for (const mode of [undefined, { videoAudioTiming: 'import' as const }]) {
		assert.deepEqual(await decodeExternal(file, recorded, undefined, mode), [expected]);
		assert.deepEqual(await decodeExternal(file, legacy, undefined, mode), [new Float32Array(46_400).fill(.25, 0, 12_288)]);
	}
	assert.deepEqual(calls, [0, 0, 1, 0, 1]);
});
