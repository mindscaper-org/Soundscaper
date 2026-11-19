/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Output, WEBM, WebMOutputFormat } from 'mediabunny';

import {
	createVideoMediabunnyMuxer,
	type VideoMediabunnyMuxRequest,
} from '../src/common/editor/video-mediabunny-muxer.ts';
import { createMonoCameraFixture } from './browser/fixtures/mono-camera-media.js';

test('a half-millisecond WebM clock retains Opus pre-skip and fits long cluster timestamps and cues', async () => {
	const camera = createMonoCameraFixture('Camera.webm');
	const source = new Input({ source: new BufferSource(camera.buffer), formats: [WEBM] });
	try {
		const audio = await source.getPrimaryAudioTrack(), video = await source.getPrimaryVideoTrack();
		assert.ok(audio && video);
		const audioConfig = await audio.getDecoderConfig(), videoConfig = await video.getDecoderConfig();
		const audioPacket = await new EncodedPacketSink(audio).getFirstPacket();
		const videoPacket = await new EncodedPacketSink(video).getFirstPacket();
		assert.ok(audioConfig?.description && videoConfig && audioPacket && videoPacket);
		const description = audioConfig.description;
		const head = Buffer.from(ArrayBuffer.isView(description)
			? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description));
		assert.equal(head.toString('ascii', 0, 8), 'OpusHead');
		head.writeUInt16LE(312, 10);
		const timestamps = [0, 16.383, 16.384, 33.2];
		const target = new BufferTarget(), clusters: number[] = [];
		const output = new Output({ target, format: new WebMOutputFormat({ timestampScale: 500_000, minimumClusterDuration: 100,
			onCluster: (_data, _position, time) => clusters.push(time),
		}) });
		const audioOutput = new EncodedAudioPacketSource('opus'), videoOutput = new EncodedVideoPacketSource('vp8');
		output.addVideoTrack(videoOutput); output.addAudioTrack(audioOutput);
		await output.start();
		await audioOutput.add(audioPacket.clone({ timestamp: -.0065, duration: .02 }), { decoderConfig: { ...audioConfig, description: head } });
		audioOutput.close();
		for (const timestamp of timestamps) await videoOutput.add(videoPacket.clone({ timestamp, duration: .04 }), { decoderConfig: videoConfig });
		await output.finalize();
		assert.ok(target.buffer);
		const readback = new Input({ source: new BufferSource(target.buffer), formats: [WEBM] });
		try {
			const audioTrack = await readback.getPrimaryAudioTrack(), videoTrack = await readback.getPrimaryVideoTrack();
			assert.ok(audioTrack && videoTrack);
			const restoredAudio = await new EncodedPacketSink(audioTrack).getFirstPacket();
			assert.ok(restoredAudio);
			assert.equal(restoredAudio.timestamp, -.0065);
			assert.equal(restoredAudio.duration, .02);
			assert.deepEqual(restoredAudio.data, audioPacket.data);
			assert.deepEqual(clusters, [0, 16.384, 33.2]);
			const videoSink = new EncodedPacketSink(videoTrack);
			const received = [];
			for await (const packet of videoSink.packets()) {
				received.push(packet.timestamp);
				assert.deepEqual(packet.data, videoPacket.data);
				if (packet.timestamp === 33.2) assert.equal(packet.duration, .04);
			}
			assert.deepEqual(received, timestamps);
			assert.equal(Math.round((await readback.computeDuration()) * 1000), 33_240);
			assert.equal((await videoSink.getKeyPacket(16.5))?.timestamp, 16.384);
			assert.equal((await videoSink.getKeyPacket(33.21))?.timestamp, 33.2);
		} finally { readback.dispose(); }
	} finally { source.dispose(); }
});

test('MP4 and WebM sessions receive their dedicated video/audio profiles and exact metadata', async () => {
	for (const profile of [
		{ format: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
		{ format: 'webm', videoCodec: 'vp9', audioCodec: 'opus' },
	] as const) {
		const record = sessionRecord();
		const muxer = createVideoMediabunnyMuxer({
			format: profile.format,
			videoCodec: profile.videoCodec,
			width: 4,
			height: 2,
			frameRate: { num: 30_000, den: 1_001 },
			frameCount: 1,
			audio: {
				codec: profile.audioCodec,
				sampleRate: 48_000,
				channelCount: 2,
				bitrate: 192_000,
			},
		}, { createSession: record.create });
		const metadata = (profile.format === 'mp4'
			? { decoderConfig: { codec: 'avc1.4d001f', description: Uint8Array.of(1, 2, 3) } }
			: { decoderConfig: { codec: 'vp09.00.10.08' } }) as EncodedVideoChunkMetadata;

		await muxer.start();
		await muxer.addVideoChunk(encodedChunk(), metadata);
		await muxer.addAudioPcm({
			data: new Uint8Array(960 * 2 * Float32Array.BYTES_PER_ELEMENT),
			frameCount: 960,
			timestamp: 0,
		});
		const result = await muxer.finalize();

		assert.equal(record.request?.format, profile.format);
		assert.equal(record.request?.videoCodec, profile.videoCodec);
		assert.equal(record.request?.audio?.codec, profile.audioCodec);
		assert.equal(record.video[0]?.metadata, metadata, 'decoder config is not reconstructed or discarded');
		assert.deepEqual(record.video[0]?.packet, {
			data: Uint8Array.of(9, 8, 7),
			type: 'key',
			timestamp: 0,
			duration: 0.033333,
			sequenceNumber: 0,
		});
		assert.equal(record.closedVideo, 1);
		assert.equal(record.closedAudio, 1);
		assert.equal(result.videoByteLength, 3);
		assert.equal(result.audioFrameCount, 960);
		assert.equal(result.decoderConfigObserved, true);
		assert.deepEqual([...result.bytes], [4, 5, 6]);
	}
});

test('the first MP4 packet must be a key frame carrying the browser decoder configuration', async () => {
	const record = sessionRecord();
	const request = {
		format: 'mp4',
		videoCodec: 'h264',
		width: 4,
		height: 2,
		frameRate: { num: 30, den: 1 },
		frameCount: 1,
	} as const;
	const withoutConfig = createVideoMediabunnyMuxer(request, { createSession: record.create });
	await withoutConfig.start();
	await assert.rejects(withoutConfig.addVideoChunk(encodedChunk()), /decoder configuration/u);
	await withoutConfig.cancel();
	assert.equal(record.canceled, 1);

	const deltaRecord = sessionRecord();
	const delta = createVideoMediabunnyMuxer(request, { createSession: deltaRecord.create });
	await delta.start();
	await assert.rejects(delta.addVideoChunk(encodedChunk('delta'), {
		decoderConfig: { codec: 'avc1.4d001f', description: Uint8Array.of(1) },
	}), /first.*key frame/u);
});

test('a browser chunk without duration uses the exact rational frame interval', async () => {
	const record = sessionRecord();
	const muxer = createVideoMediabunnyMuxer({
		format: 'webm',
		videoCodec: 'vp9',
		width: 4,
		height: 2,
		frameRate: { num: 30_000, den: 1_001 },
		frameCount: 1,
	}, { createSession: record.create });

	await muxer.start();
	await muxer.addVideoChunk({ ...encodedChunk(), duration: null });
	await muxer.finalize();

	const packet = record.video[0]?.packet as Readonly<{ duration?: unknown }> | undefined;
	assert.equal(packet?.duration, 0.033367);
});

function encodedChunk(type: 'key' | 'delta' = 'key') {
	return Object.freeze({
		byteLength: 3,
		type,
		timestamp: 0,
		duration: 33_333,
		copyTo(target: Uint8Array) { target.set([9, 8, 7]); },
	});
}

function sessionRecord() {
	const record = {
		request: null as VideoMediabunnyMuxRequest | null,
		video: [] as Readonly<{ packet: unknown; metadata?: EncodedVideoChunkMetadata }>[],
		audio: [] as unknown[],
		closedVideo: 0,
		closedAudio: 0,
		canceled: 0,
		create(request: VideoMediabunnyMuxRequest) {
			record.request = request;
			return {
				async start() {},
				async addVideo(packet: unknown, metadata?: EncodedVideoChunkMetadata) {
					(record.video as { packet: unknown; metadata?: EncodedVideoChunkMetadata }[]).push({
						packet,
						...(metadata ? { metadata } : {}),
					});
				},
				async addAudio(chunk: unknown) { (record.audio as unknown[]).push(chunk); },
				closeVideo() { record.closedVideo += 1; },
				closeAudio() { record.closedAudio += 1; },
				async finalize() { return Uint8Array.of(4, 5, 6).buffer; },
				async cancel() { record.canceled += 1; },
			};
		},
	};
	return record;
}
