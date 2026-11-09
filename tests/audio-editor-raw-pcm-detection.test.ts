/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRawPcmFormat } from '../src/common/editor/controller/import/raw-pcm-detection.ts';
import type { RawPcmByteOrder, RawPcmSampleFormat } from '../src/common/editor/controller/import/raw-pcm-import.ts';

const widths = { uint8: 1, int16: 2, int24: 3, int32: 4, float32: 4 } as const;

for (const sampleFormat of Object.keys(widths) as RawPcmSampleFormat[]) {
	for (const byteOrder of (sampleFormat === 'uint8' ? ['little'] : ['little', 'big']) as RawPcmByteOrder[]) {
		for (const channelCount of [1, 2] as const) {
			test(`detects ${sampleFormat} ${byteOrder} endian with ${channelCount} channels`, async () => {
				const file = pcmFile(sampleFormat, byteOrder, channelCount);
				assert.deepEqual(await detectRawPcmFormat(file), { sampleFormat, byteOrder, channelCount });
			});
		}
	}
}

test('detection respects the supplied byte offset and bounds reads of large files', async () => {
	const pcm = pcmFile('int24', 'big', 2);
	const body = new Uint8Array(await pcm.arrayBuffer());
	const reads: number[] = [];
	const offsetBytes = 101;
	const file = {
		size: offsetBytes + body.length * 100_000,
		slice(start: number, end: number) {
			assert.ok(start >= offsetBytes);
			reads.push(end - start);
			return new Blob([Uint8Array.from({ length: end - start }, (_, i) => body[(start - offsetBytes + i) % body.length]!)]);
		},
	} as File;
	assert.deepEqual(await detectRawPcmFormat(file, { offsetBytes }), { sampleFormat: 'int24', byteOrder: 'big', channelCount: 2 });
	assert.ok(reads.length > 0 && reads.length <= 3);
	assert.ok(reads.every(size => size <= 32_768));
});

test('empty, short, silent and unclassifiable data leave the settings undetected', async () => {
	let seed = 12345;
	const noise = Uint8Array.from({ length: 16_384 }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed >>> 24;
	});
	for (const body of [new Uint8Array(), new Uint8Array([1, 2]), new Uint8Array(16_384), new Uint8Array(16_384).fill(128), noise]) {
		assert.equal(await detectRawPcmFormat(new File([body], 'unknown.raw')), null);
	}
});

test('invalid offsets never read and cancellation fences pending reads', async () => {
	const pcm = pcmFile('int16', 'little', 1);
	let reads = 0;
	const abort = new AbortController();
	const file = {
		size: pcm.size,
		slice(start: number, end: number) {
			reads += 1;
			abort.abort();
			return pcm.slice(start, end);
		},
	} as File;
	for (const offsetBytes of [-1, 0.5, NaN, pcm.size + 1]) {
		assert.equal(await detectRawPcmFormat(file, { offsetBytes }), null);
	}
	assert.equal(reads, 0);
	await assert.rejects(detectRawPcmFormat(file, { signal: abort.signal }), { name: 'AbortError' });
	assert.equal(reads, 1);
	await assert.rejects(detectRawPcmFormat(file, { signal: abort.signal }), { name: 'AbortError' });
	assert.equal(reads, 1);
});

function pcmFile(format: RawPcmSampleFormat, order: RawPcmByteOrder, channels: number): File {
	const width = widths[format];
	const data = new Uint8Array(8192 * channels * width);
	const view = new DataView(data.buffer);
	for (let frame = 0; frame < 8192; frame += 1) {
		for (let channel = 0; channel < channels; channel += 1) {
			const sample = .53 * Math.sin(frame * (channel ? .093 : .057) + channel)
				+ .17 * Math.sin(frame * (channel ? .231 : .137));
			const offset = (frame * channels + channel) * width;
			if (format === 'float32') view.setFloat32(offset, sample, order === 'little');
			else if (format === 'uint8') view.setUint8(offset, Math.round(sample * 127 + 128));
			else {
				const value = Math.round(sample * (2 ** (width * 8 - 1) - 1));
				for (let byte = 0; byte < width; byte += 1) {
					data[offset + (order === 'little' ? byte : width - byte - 1)] = (value >> (byte * 8)) & 255;
				}
			}
		}
	}
	return new File([data], 'unknown.raw');
}
