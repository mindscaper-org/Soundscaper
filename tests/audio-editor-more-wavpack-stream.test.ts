/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';

const loadPayload = async (_format: unknown, url: URL) => Uint8Array.from(await readFile(url));

// WavPack's pinned pack_utils.c explicitly supports SetConfiguration(total_samples=-1)
// for unseekable writers; only the optional post-encode rewrite needs a known total.
test('an unseekable WavPack recording with an unknown first total imports exact PCM through bounded groups', async () => {
	const pcm = Float32Array.from({ length: 96_000 }, (_value, index) => Math.sin(index / 19) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 2 * 1024 ** 2 }, { loadPayload });
	const unknown = Uint8Array.from(encoded);
	for (let offset = 0; offset < encoded.length;) {
		const length = new DataView(encoded.buffer, encoded.byteOffset + offset).getUint32(4, true) + 8;
		unknown.set(withWavPackTotalFrames(encoded.subarray(offset, offset + length), 0xffff_ffff), offset);
		offset += length;
	}
	class RangedFile extends File { override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole-file reads are forbidden.'); } }
	const file = new RangedFile([unknown], 'Live-recording.wv', { type: 'audio/wavpack' });
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: {
		async decode(group) {
			const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await group.arrayBuffer()), maximumOutputBytes: 1024 ** 2 }, { loadPayload });
			return { channels: [new Float32Array(decoded.interleaved.buffer)], sampleRate: decoded.sampleRate };
		},
	} });
	try {
		assert.equal(prepared.descriptor.frameCount, pcm.length);
		let offset = 0;
		await prepared.stream({ chunkFrames: 4096, onChunk(channels) {
			assert.deepEqual(channels[0], pcm.subarray(offset, offset + channels[0]!.length));
			offset += channels[0]!.length;
		} });
		assert.equal(offset, pcm.length);
	} finally { prepared.dispose(); }
});
