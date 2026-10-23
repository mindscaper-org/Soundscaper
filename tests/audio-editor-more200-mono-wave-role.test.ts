/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWavHeader, createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';

/** Read the WAVEFORMATEXTENSIBLE speaker field independently of import admission. */
function waveFormat(bytes: Uint8Array): DataView {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'fmt ') return new DataView(bytes.buffer, bytes.byteOffset + offset + 8, size);
		offset += 8 + size + (size & 1);
	}
	throw new Error('WAV is missing its format chunk.');
}

for (const port of ['buffered', 'streamed'] as const) test(`the ${port}20bit mono writer declares the centre speaker`, async () => {
	const input = Float32Array.of(0, .125, -.25, .5);
	let bytes: Uint8Array;
	if (port === 'buffered') bytes = encodeWav([input], { bitDepth: 20, dither: false });
	else {
		const writer = createWavStreamEncoder({ channelCount: 1, totalFrames: input.length, bitDepth: 20, dither: false });
		writer.write([input]); const result = writer.finalize(); assert.ok(result instanceof Uint8Array); bytes = result;
	}
	const format = waveFormat(bytes);
	assert.equal(format.getUint16(0, true), 0xfffe); assert.equal(format.getUint16(2, true), 1);
	assert.equal(format.getUint16(18, true), 20); assert.equal(format.getUint32(20, true), 4, 'mono is SPEAKER_FRONT_CENTER, not the left-only role');
	const blob = new Blob([new Uint8Array(bytes)]); const descriptor = await inspectWavBlobPcm(blob);
	const { channels } = await createWavBlobPcmChunkReader(blob, { descriptor }).readChunk(0);
	assert.deepEqual(channels, [input]); assert.equal(descriptor.frameCount, input.length);
});

test('large mono RF64 headers retain the same centre-speaker declaration', () => {
	const header = createWavHeader({ channelCount: 1, bitDepth: 20, totalFrames: 1_500_000_000 });
	assert.equal(new TextDecoder().decode(header.subarray(0, 4)), 'RF64');
	assert.equal(waveFormat(header).getUint32(20, true), 4);
});

test('explicit mono speaker roles and ordinary stereo output keep their own declarations', () => {
	for (const channelMask of [0, 1, 4, 8]) {
		const bytes = encodeWav([Float32Array.of(.25)], { bitDepth: 20, channelMask });
		assert.equal(waveFormat(bytes).getUint32(20, true), channelMask);
	}
	assert.equal(waveFormat(encodeWav([Float32Array.of(.25), Float32Array.of(-.25)], { bitDepth: 20 })).getUint32(20, true), 3);
	assert.equal(waveFormat(encodeWav([Float32Array.of(.25)], { bitDepth: 24 })).getUint16(0, true), 1);
});
