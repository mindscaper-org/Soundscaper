/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeIeeeExtended80 } from '../src/common/editor/aiff.js';
import { createAiffBlobPcmChunkReader, inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { parseAiffMarkChunk } from '../src/common/editor/aiff-markers.ts';
import { createId3Artwork } from '../src/common/editor/id3-artwork.ts';

const encoder = new TextEncoder();
function chunk(id: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + body.length + body.length % 2);
	bytes.set(encoder.encode(id));
	new DataView(bytes.buffer).setUint32(4, body.length);
	bytes.set(body, 8);
	return bytes;
}
function aiff(samples: Uint8Array, bitDepth: number, options: Readonly<{ codec?: string; blockSize?: number; padding?: number }> = {}): Blob {
	const comm = new Uint8Array(options.codec ? 24 : 18);
	const view = new DataView(comm.buffer);
	view.setUint16(0, 1);
	view.setUint32(2, samples.length / Math.ceil(bitDepth / 8));
	view.setUint16(6, bitDepth);
	comm.set(encodeIeeeExtended80(44_100), 8);
	if (options.codec) comm.set(encoder.encode(options.codec), 18);
	const sound = new Uint8Array(8 + samples.length + (options.padding ?? 0));
	new DataView(sound.buffer).setUint32(4, options.blockSize ?? 0);
	sound.set(samples, 8);
	const parts = options.codec ? [chunk('FVER', Uint8Array.of(0xa2, 0x80, 0x51, 0x40))] : [];
	parts.push(chunk('COMM', comm), chunk('SSND', sound));
	const header = new Uint8Array(12);
	header.set(encoder.encode('FORM'));
	new DataView(header.buffer).setUint32(4, 4 + parts.reduce((sum, part) => sum + part.length, 0));
	header.set(encoder.encode(options.codec ? 'AIFC' : 'AIFF'), 8);
	return new Blob([header, ...parts]);
}
async function decode(file: Blob): Promise<readonly number[]> {
	const descriptor = await inspectAiffBlobPcm(file);
	return [...(await createAiffBlobPcmChunkReader(file, { descriptor }).readChunk(0)).channels[0]!];
}

test('QuickTime sowt and twos AIFF-C PCM import in their declared byte order', async () => {
	assert.deepEqual(await decode(aiff(Uint8Array.of(0, 0x80, 0, 0x40), 16, { codec: 'sowt' })), [-1, 0.5]);
	assert.deepEqual(await decode(aiff(Uint8Array.of(0x80, 0, 0x40, 0), 16, { codec: 'twos' })), [-1, 0.5]);
});

test('64-bit AIFF-C floating point originals retain audio and sanitize nonfinite samples', async () => {
	const samples = new Uint8Array(24);
	const view = new DataView(samples.buffer);
	view.setFloat64(0, -1.25);
	view.setFloat64(8, 0.5);
	view.setFloat64(16, Number.NaN);
	assert.deepEqual(await decode(aiff(samples, 64, { codec: 'fl64' })), [-1.25, 0.5, 0]);
});

test('AIFF SSND block alignment and trailing block padding do not prevent import', async () => {
	assert.deepEqual(await decode(aiff(Uint8Array.of(0x80, 0, 0x40, 0), 16, { blockSize: 8, padding: 4 })), [-1, 0.5]);
});

test('AIFF integer precision need not occupy every bit in its byte container', async () => {
	assert.deepEqual(await decode(aiff(Uint8Array.of(0x80, 0, 0x40, 0), 12)), [-1, 0.5]);
});

test('legacy AIFF marker names retain single-byte accented text', () => {
	const mark = Uint8Array.of(0, 1, 0, 1, 0, 0, 0, 0, 4, 0x43, 0x61, 0x66, 0xe9, 0);
	assert.equal(parseAiffMarkChunk(mark)[0]?.label, 'Café');
});

test('cover-art files with missing or generic MIME types are identified from image bytes', async () => {
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');
	for (const type of ['', 'application/octet-stream']) {
		const result = await createId3Artwork(new File([png], 'cover.png', { type }));
		assert.equal(result.mimeType, 'image/png');
		assert.equal(result.description, 'cover.png');
	}
});

test('8-bit AIFF originals do not offer an export shortcut whose encoder cannot represent them', async () => {
	const { resolveDesktopOriginalExportSettings } = await import('../src/common/editor/desktop-original-export-settings.ts');
	const file = new File([aiff(Uint8Array.of(0x80, 0x40), 8)], 'voice.aiff');
	assert.equal(await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', sampleRate: 44_100, channelCount: 1 }]), null);
});
