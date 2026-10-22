/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { embedAudioFileMetadata } from '../src/common/editor/audio-container-metadata.ts';
import { createId3Artwork } from '../src/common/editor/id3-artwork.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

function coverImage(): Uint8Array<ArrayBuffer> {
	const size = 256;
	const scanlines = Buffer.alloc((size * 4 + 1) * size);
	let random = 42;
	for (let row = 0; row < size; row++) for (let pixel = 1; pixel <= size * 4; pixel++) {
		random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
		scanlines[row * (size * 4 + 1) + pixel] = random & 255;
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header.set([8, 6], 8);
	const chunk = (name: string, data: Uint8Array): Buffer => {
		const bytes = Buffer.alloc(12 + data.length);
		bytes.writeUInt32BE(data.length, 0); bytes.write(name, 4); bytes.set(data, 8);
		let crc = 0xffff_ffff;
		for (const value of bytes.subarray(4, 8 + data.length)) {
			crc ^= value;
			for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
		}
		bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 8 + data.length);
		return bytes;
	};
	return Uint8Array.from(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]));
}

test('File Open decodes an exported Vorbis recording with an ordinary cover image above256KiB', async () => {
	const png = coverImage();
	assert.ok(png.length > 262_144 && png.length < 4 * 1024 ** 2);
	const picture = await createId3Artwork(new File([png], 'Cover.png', { type: 'image/png' }));
	const pcm = Float32Array.from({ length: 4800 }, (_, index) => Math.cos(index * .03) * .1);
	const bytes = await encodeDedicatedAudioPcm({ format: 'ogg-vorbis', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		sampleRate: 48_000, channelCount: 1, settings: { quality: 6 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	// File > Export Audio > Ogg Vorbis, Metadata > Add artwork uses this exact picture projection.
	const output = await embedAudioFileMetadata(new Blob([bytes]), 'ogg-vorbis', { title: 'Programme', id3Artwork: JSON.stringify([picture]) });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	const { store } = await createTwoTrackFixture('next-vorbis-artwork', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		const reference = await prepareStreamedAudioImport(new File([bytes], 'Reference.ogg', { type: 'audio/ogg' }));
		const referencePcm: Float32Array[] = [];
		await reference.stream({ chunkFrames: 65_536, onChunk(channels) { referencePcm.push(channels[0]!); } });
		await controller.ready;
		await controller.actions.project.importFiles([new File([output], 'Programme.ogg', { type: 'audio/ogg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1, 'the exported recording must reopen successfully');
		const source = project.sources[0]!;
		assert.equal(source.frameCount, pcm.length);
		assert.deepEqual(await storedChannel(store, source.id, 0), Float32Array.from(referencePcm.flatMap(channel => [...channel])),
			'album art must not change any decoded PCM sample');
		const contribution = normalizeSourceProvenance(source.provenance, 'source').contributions[0];
		assert.equal(contribution?.metadata.normalized.title, 'Programme');
		assert.ok(contribution?.attachments.some(attachment => attachment.byteLength === png.length));
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});
