/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BufferSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { aacSourceMetadata, readAacSourceMetadata, validateAacSourceGeometry } from '../src/common/editor/aac-source-geometry.ts';
import { browserAacMetadataFormat, browserAacMetadataTags } from '../src/common/editor/browser-aac-metadata.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

async function mux(metadata: Readonly<Record<string, string>> = {}, image?: Uint8Array<ArrayBuffer>): Promise<Blob> {
	const input = new Input({ source: new BufferSource(aacLcM4a48_000Fixture()), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		const packet = await new EncodedPacketSink(track).getFirstPacket();
		const config = await track.getDecoderConfig();
		assert.ok(packet && config);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', metadataFormat: browserAacMetadataFormat(metadata) }), target });
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		const tags = browserAacMetadataTags(metadata);
		output.setMetadataTags({ ...tags, ...(image ? { images: [{ data: image, mimeType: 'image/png', kind: 'coverFront' as const }] } : {}),
			raw: { ...tags.raw, scaf: aacSourceMetadata(48_000, 2, 1030) } });
		await output.start();
		for (let index = 0; index < 3; index++) await source.add(new EncodedPacket(packet.data, 'key', index * 1024 / 48_000, 1024 / 48_000), index === 0 ? { decoderConfig: config } : undefined);
		await output.finalize();
		assert.ok(target.buffer);
		return new Blob([target.buffer], { type: 'audio/mp4' });
	} finally { input.dispose(); }
}

test('AAC exported with ordinary custom metadata retains its source trim metadata on reimport', async () => {
	const file = await mux({ producer: 'Ensemble' });
	const metadata = await readAacSourceMetadata(file);
	assert.equal(metadata, aacSourceMetadata(48_000, 2, 1030));
	assert.deepEqual(validateAacSourceGeometry(metadata, { sampleRate: 48_000, channelCount: 2, encodedFrames: 3072 }), { sourceFrames: 1030, leadingFrames: 1024, trailingFrames: 1018 });
});

test('AAC artwork within the editor four MiB image limit cannot prevent audio reimport', async () => {
	const image = withPngComment(Uint8Array.from(await readFile(new URL('./electron/local-assistance-models/fixtures/astronaut.png', import.meta.url))));
	assert.ok(image.length > 1024 ** 2 && image.length <= 4 * 1024 ** 2);
	assert.equal(await readAacSourceMetadata(await mux({}, image)), aacSourceMetadata(48_000, 2, 1030));
});


/** Add a legal ancillary PNG text chunk; keep the original image pixels and CRCs. */
function withPngComment(original: Uint8Array): Uint8Array<ArrayBuffer> {
	const body = new Uint8Array(1100 * 1024).fill(88);
	body.set(new TextEncoder().encode('Comment\0'));
	const chunk = new Uint8Array(body.length + 12);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, body.length);
	chunk.set(new TextEncoder().encode('tEXt'), 4);
	chunk.set(body, 8);
	let crc = 0xffff_ffff;
	for (const byte of chunk.subarray(4, -4)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
	}
	view.setUint32(chunk.length - 4, (crc ^ 0xffff_ffff) >>> 0);
	const result = new Uint8Array(original.length + chunk.length);
	result.set(original.subarray(0, -12));
	result.set(chunk, original.length - 12);
	result.set(original.subarray(-12), result.length - 12);
	return result;
}
