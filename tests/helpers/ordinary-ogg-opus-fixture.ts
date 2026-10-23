/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, OGG, OggOutputFormat, Output, WEBM, WebMOutputFormat } from 'mediabunny';
import { createMonoCameraFixture } from '../browser/fixtures/mono-camera-media.js';

let fixtureBytes: Promise<ArrayBuffer> | undefined;
let webmBytes: Promise<ArrayBuffer> | undefined;

/** Mux the committed ordinary microphone-tone capture's Opus packets into their normal Ogg container. */
export async function ordinaryOggOpusFixture(extension: 'ogg' | 'opus' = 'ogg'): Promise<File> {
	const bytes = await (fixtureBytes ??= createOrdinaryOggOpusBytes());
	return new File([bytes], `Programme.${extension}`, { type: 'audio/ogg; codecs=opus' });
}

/** Keep the ordinary capture's native Opus clock in an audio-only Matroska-family file. */
export async function ordinaryWebmOpusFixture(extension: 'webm' | 'mka' = 'webm'): Promise<File> {
	const bytes = await (webmBytes ??= createOrdinaryOggOpusBytes(true));
	return new File([bytes], `Programme.${extension}`, { type: extension === 'mka' ? 'audio/x-matroska' : 'audio/webm' });
}

/** RFC9559's zero track target is the explicit all-tracks form of a global tag. */
export async function taggedWebmOpusFixture(target: 'global' | 'all-tracks' | 'track'): Promise<File> {
	const bytes = new Uint8Array(await createOrdinaryOggOpusBytes(true, true));
	if (target !== 'global') {
		const marker = Uint8Array.of(0x63, 0xca, 0x85, ...new TextEncoder().encode('MOVIE'));
		const offset = Buffer.from(bytes).indexOf(marker);
		assert.ok(offset >= 0);
		// Replace the optional TargetType with an equal-size target and Void, preserving every seek offset.
		bytes.set(Uint8Array.of(0x63, 0xc5, 0x81, target === 'all-tracks' ? 0 : 1, 0xec, 0x82, 0, 0), offset);
	}
	return new File([bytes], 'Tagged.webm', { type: 'audio/webm' });
}

async function createOrdinaryOggOpusBytes(webm = false, tagged = false): Promise<ArrayBuffer> {
	const camera = createMonoCameraFixture('Microphone.webm');
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(camera.buffer)])), formats: [WEBM] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		assert.equal(track.codec, 'opus');
		const decoderConfig = await track.getDecoderConfig();
		assert.ok(decoderConfig);
		const target = new BufferTarget();
		const output = new Output({ format: webm ? new WebMOutputFormat() : new OggOutputFormat(), target });
		if (tagged) output.setMetadataTags({ title: 'Authored global title', artist: 'Ada — reviewed credit' });
		const source = new EncodedAudioPacketSource('opus');
		output.addAudioTrack(source);
		await output.start();
		for await (const packet of new EncodedPacketSink(track).packets()) await source.add(packet, { decoderConfig });
		await output.finalize();
		assert.ok(target.buffer);
		const file = new File([target.buffer], 'Programme.ogg', { type: 'audio/ogg; codecs=opus' });
		const readback = new Input({ source: new BlobSource(file), formats: [webm ? WEBM : OGG] });
		try {
			const audio = await readback.getPrimaryAudioTrack();
			assert.equal(audio?.codec, 'opus');
			assert.equal(audio?.sampleRate, 48_000);
			assert.equal(audio?.numberOfChannels, 1);
			assert.ok(await readback.computeDuration() > 0.5);
		} finally { readback.dispose(); }
		return target.buffer;
	} finally { input.dispose(); }
}
