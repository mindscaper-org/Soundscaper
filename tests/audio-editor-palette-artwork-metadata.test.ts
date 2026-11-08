/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { createId3Artwork } from '../src/common/editor/id3-artwork.ts';
import { encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { embedAudioFileMetadata } from '../src/common/editor/audio-container-metadata.ts';
import { flacPictureBytes } from '../src/common/editor/audio-metadata-values.ts';

// Valid two-color indexed PNG, independently decoded by libpng in the conformance proof.
const PALETTE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAABlBMVEX/AAAAAP9sof2OAAAADElEQVR4nGNwYGgAAAFEAME6ehxWAAAAAElFTkSuQmCC';
const GRAY_ALPHA_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) };

function descriptor(bytes: Uint8Array): readonly number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8 + view.getUint32(4);
	offset += 4 + view.getUint32(offset);
	return [0, 4, 8, 12].map(index => view.getUint32(offset + index));
}

function flacPicture(bytes: Uint8Array): Uint8Array {
	for (let offset = 4; offset + 4 <= bytes.length;) {
		const header = bytes[offset]!, size = bytes[offset + 1]! * 65_536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
		if ((header & 127) === 6) return bytes.subarray(offset + 4, offset + 4 + size);
		if (header & 128) break;
		offset += 4 + size;
	}
	throw new Error('The delivered FLAC has no PICTURE block.');
}

for (const format of ['flac', 'opus', 'ogg-vorbis'] as const) test(`${format} delivery describes indexed artwork as RGB with its actual palette size`, async () => {
	const png = Uint8Array.from(Buffer.from(PALETTE_PNG, 'base64'));
	const artwork = await createId3Artwork(new File([png], 'Palette.png', { type: 'image/png' }));
	const pcm = new Float32Array(4608);
	const settings: Readonly<Record<string, number>> = format === 'flac' ? { compressionLevel: 5 }
		: format === 'opus' ? { bitrateKbps: 128, vbrMode: 1 } : { quality: 5 };
	const encoded = await encodeDedicatedAudioPcm({ format, settings, input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, maximumOutputBytes: 1024 * 1024 }, dependencies);
	const delivered = await embedAudioFileMetadata(new Blob([encoded]), format, { id3Artwork: JSON.stringify([artwork]) });
	const input = new Input({ source: new BlobSource(delivered), formats: ALL_FORMATS });
	try {
		const tags = await input.getMetadataTags();
		assert.deepEqual(tags.images?.[0]?.data, png, 'the image payload remains exact');
		if (format === 'flac') assert.deepEqual(descriptor(flacPicture(new Uint8Array(await delivered.arrayBuffer()))), [2, 2, 24, 2]);
		else {
			const picture = tags.raw?.METADATA_BLOCK_PICTURE;
			assert.equal(typeof picture, 'string');
			assert.ok(typeof picture === 'string');
			assert.deepEqual(descriptor(Uint8Array.from(Buffer.from(picture, 'base64'))), [2, 2, 24, 2]);
		}
	} finally { input.dispose(); }
});

test('ordinary non-indexed PNG artwork keeps its actual sample depth and zero palette count', async () => {
	const png = Uint8Array.from(Buffer.from(GRAY_ALPHA_PNG, 'base64'));
	const artwork = await createId3Artwork(new File([png], 'Gray.png', { type: 'image/png' }));
	assert.deepEqual(descriptor(flacPictureBytes(artwork)), [1, 1, 16, 0]);
});
