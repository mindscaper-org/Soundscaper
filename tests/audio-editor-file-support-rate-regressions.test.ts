/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';

const encoder = new TextEncoder();
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}
function flac(rate: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(42);
	bytes.set(encoder.encode('fLaC'));
	bytes[4] = 128;
	bytes[7] = 34;
	bytes[18] = rate >>> 12;
	bytes[19] = rate >>> 4;
	bytes[20] = (rate & 15) << 4;
	return bytes;
}
function page(body: Uint8Array, serial: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(28 + body.length);
	bytes.set(encoder.encode('OggS'));
	bytes[5] = 2;
	bytes[26] = 1;
	bytes[27] = body.length;
	bytes.set(body, 28);
	const view = new DataView(bytes.buffer);
	view.setUint32(14, serial, true);
	view.setUint32(22, oggPageCrc(bytes), true);
	return bytes;
}

test('FLAC originals retain their source rate after an artwork-sized ID3 prefix', () => {
	const tag = new Uint8Array(10 + 70_000);
	tag.set(encoder.encode('ID3'));
	tag[3] = 4;
	let size = tag.length - 10;
	for (let index = 9; index >= 6; index--) { tag[index] = size & 127; size >>>= 7; }
	const bytes = join(tag, flac(96_000));
	assert.equal(inspectEncodedAudioSampleRate(bytes), 96_000);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 96_000);
});

test('WavPack nonstandard-rate metadata prevents resampling to the editor context', () => {
	const bytes = new Uint8Array(38);
	bytes.set(encoder.encode('wvpk'));
	const view = new DataView(bytes.buffer);
	view.setUint32(4, bytes.length - 8, true);
	view.setUint32(24, 15 << 23, true);
	bytes.set([0x67, 2, 0x35, 0x82, 0, 0], 32); // ID_SAMPLE_RATE, odd 3-byte 33333 Hz value.
	assert.equal(inspectEncodedAudioSampleRate(bytes), 33_333);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 33_333);
});

test('free-format MPEG audio still declares an exact source sample rate', () => {
	const bytes = Uint8Array.of(0xff, 0xfb, 0x00, 0xc0);
	assert.equal(inspectEncodedAudioSampleRate(bytes), 44_100);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 44_100);
});

test('Ogg Skeleton headers do not hide the first audio stream sample rate', () => {
	const skeleton = new Uint8Array(64);
	skeleton.set(encoder.encode('fishead\0'));
	const vorbis = new Uint8Array(30);
	vorbis.set(encoder.encode('\u0001vorbis'));
	vorbis[11] = 1;
	new DataView(vorbis.buffer).setUint32(12, 32_000, true);
	const bytes = join(page(skeleton, 1), page(vorbis, 2));
	assert.equal(inspectEncodedAudioSampleRate(bytes), 32_000);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 32_000);
});

test('Ogg-FLAC rate inspection reads the mapped STREAMINFO header', () => {
	const stream = flac(88_200);
	stream[4] = 0;
	const packet = join(Uint8Array.of(0x7f, 70, 76, 65, 67, 1, 0, 0, 1), stream);
	assert.equal(inspectEncodedAudioSampleRate(page(packet, 3)), 88_200);
	assert.equal(inspectDecodedAudioSampleRate(page(packet, 3)), 88_200);
});
