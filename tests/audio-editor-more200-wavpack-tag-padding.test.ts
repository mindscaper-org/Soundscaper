/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPaddedMetadataWavPackFixture, withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';
import { wavPackAudioBlob, readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { decodeDedicatedAudioFile } from '../src/common/editor/browser-dedicated-audio-codec.ts';

const decoder = { async decode(group: Blob) {
	const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await group.arrayBuffer()), maximumOutputBytes: 2 * 1024 ** 2 },
		{ loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const values = new DataView(decoded.interleaved.buffer);
	return { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.channelCount }, (_, channel) =>
		Float32Array.from({ length: decoded.frameCount }, (_, frame) => values.getFloat32((frame * decoded.channelCount + channel) * 4, true))) };
} };

for (const retainTag of [true, false]) for (const padding of [0, 16, 4096, 131_073]) test(`WavPack imports all PCM after a native tag edit leaves ${String(padding)} zero bytes (tag=${String(retainTag)})`, async () => {
	const file = await createPaddedMetadataWavPackFixture(padding, retainTag);
	assert.equal((await readApeMetadataTags(file)).title, retainTag ? 'Shorter edited metadata' : undefined);
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: decoder }); let position = 0;
	try {
		assert.equal(prepared.descriptor.frameCount, 4800);
		await prepared.stream({ chunkFrames: 1024, onChunk(channels) {
			for (let frame = 0; frame < channels[0]!.length; frame++) {
				assert.equal(channels[0]![frame], Math.fround(Math.sin((position + frame) * .1) * .2));
				assert.equal(channels[1]![frame], Math.fround(Math.cos((position + frame) * .03) * .1));
			}
			position += channels[0]!.length;
		} });
		assert.equal(position, 4800);
	} finally { prepared.dispose(); }
});

test('terminal zero padding also retains the bounded unseekable encoder frame inference', async () => {
	const file = await createPaddedMetadataWavPackFixture(4096); const audio = await wavPackAudioBlob(await createPaddedMetadataWavPackFixture(0));
	const bytes = new Uint8Array(await file.arrayBuffer()); const raw = withWavPackTotalFrames(new Uint8Array(await audio.arrayBuffer()), 0xffff_ffff);
	const selected = new File([raw, bytes.subarray(audio.size)], file.name);
	const prepared = await prepareStreamedAudioImport(selected, { desktopCodec: decoder }); let frames = 0;
	try { await prepared.stream({ chunkFrames: 1024, onChunk(channels) { frames += channels[0]!.length; } }); assert.equal(frames, 4800); }
	finally { prepared.dispose(); }
});

test('nonzero junk at the same trailer boundary remains a refusal', async () => {
	const file = await createPaddedMetadataWavPackFixture(131_073); const audio = await wavPackAudioBlob(await createPaddedMetadataWavPackFixture(0));
	const bytes = new Uint8Array(await file.arrayBuffer()); bytes[audio.size + 100_123] = 1;
	const prepared = await prepareStreamedAudioImport(new File([bytes], file.name), { desktopCodec: decoder });
	try { await assert.rejects(prepared.stream({ chunkFrames: 1024, onChunk() {} }), /WavPack/u); }
	finally { prepared.dispose(); }
});

test('an incomplete channel group is never hidden by terminal zeros', async () => {
	const file = await createPaddedMetadataWavPackFixture(4096); const audio = await wavPackAudioBlob(await createPaddedMetadataWavPackFixture(0));
	const bytes = new Uint8Array(await file.arrayBuffer()); const view = new DataView(bytes.buffer);
	view.setUint32(24, view.getUint32(24, true) & ~0x1000, true);
	assert.equal((await wavPackAudioBlob(new Blob([bytes]))).size, audio.size + 4096);
});

test('abort while checking terminal padding retains its reason and bounded reads', async () => {
	const file = await createPaddedMetadataWavPackFixture(131_073); const audio = await wavPackAudioBlob(await createPaddedMetadataWavPackFixture(0));
	const abort = new AbortController(); const reason = new DOMException('Retired padding read', 'AbortError');
	class RetiredFile extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		const part = super.slice(start, end, type); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = async () => { assert.ok(end - start <= 65_536); const bytes = await read();
			if (start > audio.size && end - start > 32) abort.abort(reason); return bytes;
		}; return part;
	} }
	await assert.rejects(wavPackAudioBlob(new RetiredFile([file], file.name), abort.signal), (error: unknown) => error === reason);
});
