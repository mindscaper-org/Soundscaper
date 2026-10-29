/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

/** Independent PCM oracle for downloaded WAV exports; never starts a native decoder. */
export function readWavePcm(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
	assert.ok(bytes.byteLength >= 12, 'WAV header is truncated.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (offset: number): string => new TextDecoder().decode(bytes.subarray(offset, offset + 4));
	assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE');
	const end = 8 + view.getUint32(4, true);
	assert.equal(end, bytes.byteLength, 'WAV payload is truncated or has unexpected trailing bytes.');
	let format: { encoding: number; channels: number; rate: number; alignment: number; bits: number } | undefined;
	let data: Uint8Array | undefined;
	for (let offset = 12; offset < end;) {
		assert.ok(offset + 8 <= end, 'WAV chunk header is truncated.');
		const size = view.getUint32(offset + 4, true), start = offset + 8;
		assert.ok(start + size <= end, 'WAV chunk is truncated.');
		if (tag(offset) === 'fmt ') {
			assert.ok(!format && size >= 16, 'WAV PCM format is missing or duplicated.');
			format = { encoding: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
				rate: view.getUint32(start + 4, true), alignment: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
		} else if (tag(offset) === 'data') {
			assert.ok(!data, 'WAV PCM data is duplicated.');
			data = bytes.subarray(start, start + size);
		}
		offset = start + size + (size % 2);
	}
	assert.ok(format && data, 'WAV PCM format and data are required.');
	assert.ok(format.encoding === 3 && format.bits === 32
		|| format.encoding === 1 && [16, 24, 32].includes(format.bits), 'Expected uncompressed PCM WAV.');
	const sampleBytes = format.bits / 8;
	assert.ok(format.channels > 0 && format.rate > 0, 'WAV PCM geometry must be positive.');
	assert.equal(format.alignment, format.channels * sampleBytes, 'Invalid WAV PCM block alignment.');
	assert.equal(data.byteLength % format.alignment, 0, 'WAV PCM contains an incomplete frame.');
	const frames = data.byteLength / format.alignment;
	const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
	const pcm = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels.length; channel++) {
		const offset = frame * format.alignment + channel * sampleBytes;
		const sample: number = format.encoding === 3 ? pcm.readFloatLE(offset) : pcm.readIntLE(offset, sampleBytes) / 2 ** (format.bits - 1);
		assert.ok(Number.isFinite(sample), 'WAV PCM contains a non-finite sample.');
		channels[channel][frame] = sample;
	}
	return { sampleRate: format.rate, channels };
}
