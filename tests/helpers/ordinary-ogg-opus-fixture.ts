/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { AttachedFile, BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedVideoPacketSource, EncodedPacketSink, Input, OGG, OggOutputFormat, Output, WEBM, WebMOutputFormat, type EncodedPacket, type MetadataTags } from 'mediabunny';
import { createMonoCameraFixture } from '../browser/fixtures/mono-camera-media.js';

let fixtureBytes: Promise<ArrayBuffer> | undefined;
let webmBytes: Promise<ArrayBuffer> | undefined;

/** Three authenticated25fps VP8 pictures plus the existing80ms six-channel Opus programme. */
export async function surroundAvWebmFixture(): Promise<File> {
	const camera = createMonoCameraFixture('Camera.webm');
	const audio = new Input({ source: new BlobSource(surroundWebmOpusFixture()), formats: [WEBM] });
	const video = new Input({ source: new BlobSource(new Blob([Uint8Array.from(camera.buffer)])), formats: [WEBM] });
	try {
		const audioTrack = await audio.getPrimaryAudioTrack(), videoTrack = await video.getPrimaryVideoTrack();
		assert.ok(audioTrack && videoTrack); assert.equal(videoTrack.codec, 'vp8');
		const audioConfig = await audioTrack.getDecoderConfig(), videoConfig = await videoTrack.getDecoderConfig();
		assert.ok(audioConfig && videoConfig);
		const target = new BufferTarget(), output = new Output({ format: new WebMOutputFormat(), target });
		const audioSource = new EncodedAudioPacketSource('opus'), videoSource = new EncodedVideoPacketSource('vp8');
		output.addVideoTrack(videoSource, { frameRate: 25 }); output.addAudioTrack(audioSource); await output.start();
		let ordinal = 0;
		for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
			await videoSource.add(packet.clone({ timestamp: ordinal / 25, duration: 1 / 25 }), { decoderConfig: videoConfig });
			if (++ordinal === 3) break;
		}
		for await (const packet of new EncodedPacketSink(audioTrack).packets()) await audioSource.add(packet, { decoderConfig: audioConfig });
		await output.finalize(); assert.ok(target.buffer);
		return new File([target.buffer], 'Surround camera.webm', { type: 'video/webm' });
	} finally { audio.dispose(); video.dispose(); }
}

/** Mux the committed ordinary microphone-tone capture's Opus packets into their normal Ogg container. */
export async function ordinaryOggOpusFixture(extension: 'ogg' | 'opus' = 'ogg'): Promise<File> {
	const bytes = await (fixtureBytes ??= createOrdinaryOggOpusBytes());
	return new File([bytes], `Programme.${extension}`, { type: 'audio/ogg; codecs=opus' });
}

/** Keep the authentic mapping-family1 packets and their six-channel order. */
export async function surroundOggOpusFixture(repetitions = 1): Promise<File> {
	const input = new Input({ source: new BlobSource(surroundWebmOpusFixture()), formats: [WEBM] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		const decoderConfig = await track.getDecoderConfig(); assert.ok(decoderConfig);
		const packets: EncodedPacket[] = [];
		for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);
		const target = new BufferTarget();
		const output = new Output({ format: new OggOutputFormat(), target });
		const source = new EncodedAudioPacketSource('opus'); output.addAudioTrack(source); await output.start();
		for (let repeat = 0; repeat < repetitions; repeat++) for (const packet of packets) {
			await source.add(packet.clone({ timestamp: packet.timestamp + repeat * .08 }), { decoderConfig });
		}
		await output.finalize(); assert.ok(target.buffer);
		return new File([target.buffer], 'Surround.ogg', { type: 'audio/ogg' });
	} finally { input.dispose(); }
}

/** Keep the ordinary capture's native Opus clock in an audio-only Matroska-family file. */
export async function ordinaryWebmOpusFixture(extension: 'webm' | 'mka' = 'webm'): Promise<File> {
	const bytes = await (webmBytes ??= createOrdinaryOggOpusBytes(true));
	return new File([bytes], `Programme.${extension}`, { type: extension === 'mka' ? 'audio/x-matroska' : 'audio/webm' });
}

/** Authenticated Opus packets with ordinary Matroska private/custom tag names. */
export async function customTaggedWebmOpusFixture(metadata: Readonly<Record<string, string | Uint8Array>>): Promise<File> {
	return new File([await createOrdinaryOggOpusBytes(true, false, { raw: metadata })], 'Private-credits.webm', { type: 'audio/webm' });
}

/** The standard ORIGINAL nesting tag describes the source work, not this programme. */
export async function originalWorkTaggedWebmOpusFixture(originalFirst = false): Promise<File> {
	const original = new TextEncoder().encode('Original performer');
	const name = Uint8Array.of(0x45, 0xa3, 0x86, ...new TextEncoder().encode('ARTIST'));
	const value = Uint8Array.of(0x44, 0x87, 0x80 | original.length, ...original);
	const child = Uint8Array.of(0x67, 0xc8, 0x10, 0, 0, name.length + value.length, ...name, ...value);
	const container = 'x'.repeat(child.length - 3);
	const raw = originalFirst ? { ORIGINAL: container, ARTIST: 'Current performer', TITLE: 'Current title' }
		: { ARTIST: 'Current performer', ORIGINAL: container, TITLE: 'Current title' };
	const file = await customTaggedWebmOpusFixture(raw);
	const bytes = Buffer.from(await file.arrayBuffer());
	const offset = bytes.indexOf(Buffer.from('ORIGINAL')) + 8; assert.ok(offset > 8);
	assert.equal(bytes.subarray(offset, offset + 3).toString('hex'), `4487${(0x80 | container.length).toString(16)}`);
	// Equal-size replacement preserves the parent/segment sizes and every seek offset.
	bytes.set(child, offset);
	return new File([bytes], 'Original-work-credits.webm', { type: 'audio/webm' });
}

/** Separate SimpleTag records, as required for multiple Matroska performer values. */
export async function repeatedTaggedWebmOpusFixture(repeated = true): Promise<File> {
	const bytes = new Uint8Array(await createOrdinaryOggOpusBytes(true, false, { raw: repeated
		? { ARTIST: 'Ada', _GUEST: 'Grace', _THIRD: 'Ada', PART_NUMBER: '2/12', COMMENT: 'After credits' }
		: { ARTIST: 'Ada', PART_NUMBER: '2/12', COMMENT: 'After credits' } }));
	for (const placeholder of repeated ? ['_GUEST', '_THIRD'] : []) {
		const offset = Buffer.from(bytes).indexOf(new TextEncoder().encode(placeholder)); assert.ok(offset >= 0);
		// Equal-size TagName substitution leaves all EBML sizes and seek offsets valid.
		bytes.set(new TextEncoder().encode('ARTIST'), offset);
	}
	return new File([bytes], 'Performers.webm', { type: 'audio/webm' });
}

/** Explicitly nondefault translations are not additional default performer credits. */
export async function translatedTaggedWebmOpusFixture(nonDefault = true, flagLast = false): Promise<File> {
	const translation = new TextEncoder().encode('Translated performer');
	const file = await customTaggedWebmOpusFixture({ ARTIST: 'x'.repeat(translation.length + 4), _GUEST: 'Default performer', COMMENT: 'After credits' });
	const bytes = Buffer.from(await file.arrayBuffer());
	const name = Buffer.from([0x45, 0xa3, 0x86, ...Buffer.from('ARTIST')]);
	const start = bytes.indexOf(name) + name.length; assert.ok(start >= name.length);
	const value = Buffer.from([0x44, 0x87, 0x80 | translation.length, ...translation]);
	const flag = Buffer.from([0x44, 0x84, 0x81, nonDefault ? 0 : 1]);
	// Equal-size element substitution retains all Segment/SeekHead/packet offsets.
	bytes.set(Buffer.concat(flagLast ? [value, flag] : [flag, value]), start);
	const secondName = bytes.indexOf(Buffer.from('_GUEST')); assert.ok(secondName > start);
	bytes.set(Buffer.from('ARTIST'), secondName);
	return new File([Uint8Array.from(bytes).buffer], 'Translated-credits.webm', { type: 'audio/webm' });
}

/** EBML does not impose a name/value or target/value child order. */
export async function reorderedTaggedWebmOpusFixture(mode: 'name-first' | 'value-first' | 'targets-last'): Promise<File> {
	const original = mode === 'targets-last' ? await taggedWebmOpusFixture('track') : await customTaggedWebmOpusFixture({ ARTIST: 'Ada' });
	const bytes = Buffer.from(await original.arrayBuffer());
	if (mode === 'value-first') {
		const name = Buffer.from([0x45, 0xa3, 0x86, ...new TextEncoder().encode('ARTIST')]);
		const offset = bytes.indexOf(name); assert.ok(offset > 0);
		const value = bytes.subarray(offset + name.length, offset + name.length + 6); assert.equal(value.toString('hex'), '448783416461');
		bytes.set(Buffer.concat([value, name]), offset);
	} else if (mode === 'targets-last') {
		const tag = bytes.indexOf(Buffer.from([0x73, 0x73])); const targets = bytes.indexOf(Buffer.from([0x63, 0xc0]));
		assert.ok(tag > 0 && targets === tag + 6); assert.equal(bytes[tag + 2], 0x10); assert.equal(bytes[targets + 2], 0x10);
		const end = tag + 6 + (bytes.readUInt32BE(tag + 2) & 0x0fff_ffff);
		const targetEnd = targets + 6 + (bytes.readUInt32BE(targets + 2) & 0x0fff_ffff);
		const targetBytes = Buffer.from(bytes.subarray(targets, targetEnd));
		bytes.copyWithin(targets, targetEnd, end); bytes.set(targetBytes, end - targetBytes.length);
	}
	return new File([bytes], `Tag-order-${mode}.webm`, { type: 'audio/webm' });
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

async function createOrdinaryOggOpusBytes(webm = false, tagged = false, metadata?: MetadataTags): Promise<ArrayBuffer> {
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
		if (metadata) output.setMetadataTags(metadata);
		else if (tagged) output.setMetadataTags({ title: 'Authored global title', artist: 'Ada — reviewed credit' });
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

/** Native libopus mapping-family1 control: six distinct tones, four20ms packets. */
export function surroundWebmOpusFixture(): File {
	return new File([Buffer.from(
		'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',
		'base64')], 'Surround.webm', { type: 'audio/webm' });
}

/** A valid numeric SimpleTag name shares no EBML namespace with an attachment UID. */
export async function attachmentCollisionWebmOpusFixture(collision = true, tagsFirst = false): Promise<File> {
	const file = await createOrdinaryOggOpusBytes(true, false, { raw: {
		'123': new AttachedFile(new TextEncoder().encode('Reviewed licence attachment'), 'text/plain', 'licence.txt', 'Licence evidence'),
		'_23': 'Reviewed archive credit', 'attachment:123': 'Existing private escape-name control', TITLE: 'Collision programme',
	} });
	const bytes = Buffer.from(file);
	const marker = Buffer.from([0x45, 0xa3, 0x83, ...Buffer.from('_23')]);
	const position = bytes.indexOf(marker); assert.ok(position > 0);
	if (collision) bytes.set(Buffer.from('123'), position + 3);
	// Equal-size replacement preserves every source packet, parent extent and seek entry.
	if (tagsFirst) {
		const attachmentId = Buffer.from('1941a469', 'hex'), tagsId = Buffer.from('1254c367', 'hex');
		const attachment = bytes.lastIndexOf(attachmentId), tags = bytes.lastIndexOf(tagsId);
		const attachmentBytes = 8 + (bytes.readUInt32BE(attachment + 4) & 0x0fff_ffff);
		const tagBytes = 8 + (bytes.readUInt32BE(tags + 4) & 0x0fff_ffff);
		assert.equal(attachment + attachmentBytes, tags);
		const body = Buffer.concat([bytes.subarray(tags, tags + tagBytes), bytes.subarray(attachment, attachment + attachmentBytes)]);
		bytes.set(body, attachment);
		for (const [id, original, destination] of [[attachmentId, attachment, attachment + tagBytes], [tagsId, tags, attachment]] as const) {
			const seek = bytes.indexOf(Buffer.concat([Buffer.from('53ab84', 'hex'), id])); assert.ok(seek > 0);
			assert.equal(bytes.subarray(seek + 7, seek + 10).toString('hex'), '53ac85');
			let value = 0; for (let index = 0; index < 5; index++) value = value * 256 + bytes[seek + 10 + index]!;
			value += destination - original;
			for (let index = 4; index >= 0; index--) { bytes[seek + 10 + index] = value % 256; value = Math.floor(value / 256); }
		}
	}
	return new File([Uint8Array.from(bytes)], `Attachment-${collision ? 'collision' : 'control'}.webm`, { type: 'audio/webm' });
}
