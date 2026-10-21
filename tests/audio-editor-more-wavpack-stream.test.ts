/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
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

// pack_utils.c:write_metadata_block emits this zero-sample layout for a trailing
// MD5 or preserved RIFF trailer after WavpackFlushSamples().
function md5Block(first: Uint8Array, pcm: Float32Array): Uint8Array<ArrayBuffer> {
	const block = new Uint8Array(50);
	block.set(first.subarray(0, 10));
	const view = new DataView(block.buffer);
	view.setUint32(4, block.length - 8, true);
	block.set([0x26, 8], 32);
	block.set(createHash('md5').update(new Uint8Array(pcm.buffer)).digest(), 34);
	return withWavPackTotalFrames(block, pcm.length);
}

for (const placement of ['leading', 'trailing'] as const) test(`a WavPack file with a standard ${placement} metadata block imports all audible PCM`, async () => {
	const { loadWavPackWasm } = await import('../src/common/editor/wavpack/runtime.js');
	const pcm = Float32Array.from({ length: 32_000 }, (_value, index) => Math.sin(index / 19) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2 }, { loadPayload });
	const trailer = md5Block(encoded, pcm);
	const bytes = new Uint8Array(encoded.length + trailer.length);
	bytes.set(placement === 'leading' ? trailer : encoded);
	bytes.set(placement === 'leading' ? encoded : trailer, placement === 'leading' ? trailer.length : encoded.length);
	// The actual pinned codec accepts the complete container, independently of
	// the application's streaming group parser.
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	assert.deepEqual(new Float32Array(runtime.decode(bytes, { frames: pcm.length, channelCount: 1, sampleRate: 48_000 })), pcm);
	const file = new File([bytes], 'Archival-recording.wv');
	const settings = await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', sampleRate: 48_000, channelCount: 1 }]);
	assert.equal(settings?.sampleFormat, 'float32', 'Original export uses the audio block flags after wrapper/MD5 metadata');
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: {
		async decode(group) { return { channels: [new Float32Array(runtime.decode(await group.arrayBuffer(), {
			frames: pcm.length, channelCount: 1, sampleRate: 48_000,
		}))], sampleRate: 48_000 }; },
	} });
	try {
		let frames = 0;
		await prepared.stream({ chunkFrames: 4096, onChunk(channels) {
			assert.deepEqual(channels[0], pcm.subarray(frames, frames + channels[0]!.length));
			frames += channels[0]!.length;
		} });
		assert.equal(frames, pcm.length);
	} finally { prepared.dispose(); }
});
