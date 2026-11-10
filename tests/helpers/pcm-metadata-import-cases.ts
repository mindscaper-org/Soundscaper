/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { createId3Artwork } from '../../src/common/editor/id3-artwork.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { readWavePcm } from './read-wave-pcm.ts';
import { riffInfoLengthFixture } from './riff-info-length-fixtures.ts';

export interface PcmMetadataImportCase {
	readonly file: File;
	readonly expectedTags: Readonly<Record<string, string | number>>;
	readonly expectedPcm: readonly Float32Array[];
	readonly expectedSampleRate: number;
	readonly truncated?: boolean;
	readonly artwork?: Readonly<{ sha256: string; byteLength: number }>;
	readonly sharingComment?: string;
	readonly expectedBextDescription?: string;
	readonly expectedMarker?: Readonly<{ name: string; positionFrame: number }>;
}

/** The browser batches these inputs; Node admits and reopens each independently. */
export async function pcmTextMetadataCases(): Promise<readonly PcmMetadataImportCase[]> {
	const cases: PcmMetadataImportCase[] = [
		frozenPcm16('libsndfile-utf8-text.aiff', 'studio-notes.aiff', {
			title: 'Straße am Meer', artist: 'Élodie', comment: 'Recorded at dawn',
		}),
		frozenPcm16('bwfmetaedit-cp1252-info.wav', 'field-notes.wav', {
			title: 'Straße am Meer', artist: 'Élodie – field recording',
		}),
	];
	const metadata = { title: 'Reviewed recording', artist: 'Ada', album: 'Field sessions', genre: 'Ambient',
		composer: 'Éva', copyright: '© 2026 Ada', publisher: 'Reviewed studio', track: '3/9', year: '2026' };
	for (const format of ['wav', 'aiff', 'aifc']) {
		const expectedPcm = [new Float32Array(4800).fill(.25)];
		const options = { sampleRate: 48_000, bitDepth: 24 as const, float: format === 'aifc', dither: false, metadata };
		const bytes = format === 'wav' ? encodeWav(expectedPcm, options) : encodeAiff(expectedPcm, options);
		assert.ok(bytes instanceof Uint8Array);
		cases.push({ file: new File([Uint8Array.from(bytes)], `Recording.${format}`, { type: format === 'wav' ? 'audio/wav' : 'audio/aiff' }),
			expectedTags: { title: 'Reviewed recording', artist: 'Ada', album: 'Field sessions', genre: 'Ambient',
				trackNumber: 3, tracksTotal: 9, date: '2026-01-01T00:00:00.000Z' }, expectedPcm, expectedSampleRate: 48_000 });
	}
	for (const long of [false, true]) {
		const bytes = riffInfoLengthFixture(long);
		cases.push({ file: new File([bytes], `Production notes ${long ? 'long' : 'short'}.wav`, { type: 'audio/wav' }),
			expectedTags: { artist: 'Small independent credit', title: 'Harbour voices', comment: 'x'.repeat(long ? 65_536 : 100) },
			expectedPcm: readWavePcm(bytes).channels, expectedSampleRate: 48_000, truncated: long });
	}
	const png = largeArtworkPng();
	const front = await createId3Artwork(new File([png], 'Front.png'));
	const back = { ...await createId3Artwork(new File([png], 'Back.png')), pictureType: 4 };
	const expectedPcm = [new Float32Array(4800).fill(.25)];
	const bytes = encodeAiff(expectedPcm, { sampleRate: 48_000, sampleFormat: 'float32',
		metadata: { title: 'Artwork recording', artist: 'Recordist', id3Artwork: JSON.stringify([front, back]) } });
	assert.ok(bytes instanceof Uint8Array);
	cases.push({ file: new File([Uint8Array.from(bytes)], 'Art.aiff', { type: 'audio/aiff' }), expectedPcm, expectedSampleRate: 48_000,
		expectedTags: { title: 'Artwork recording', artist: 'Recordist' },
		artwork: { sha256: createHash('sha256').update(png).digest('hex'), byteLength: png.byteLength } });
	return cases;
}

export function aiffCommentMetadataCases(): readonly PcmMetadataImportCase[] {
	return [
		{ ...frozenPcm16('sox-comt-comment.aiff', 'Harbour.aiff', { comment: 'Harbour take 7' }), sharingComment: 'Harbour take 7' },
		{ ...frozenPcm16('libsndfile-comment-whitespace.aiff', 'Scene.aiff', { comment: '\n  Scene one\n    Door closes\n' }),
			expectedSampleRate: 40, sharingComment: 'Scene one' },
	];
}

export function oversizedWavMetadataCase(): PcmMetadataImportCase {
	const expectedPcm = [new Float32Array(4800).fill(.25)];
	const base = Uint8Array.from(encodeWav(expectedPcm, { container: 'bw64', sampleRate: 48_000, bitDepth: 16,
		dither: false, bext: { description: 'Retained recorder metadata' }, metadata: { title: 'Retained title' },
		markers: [{ sampleOffset: 1200, label: 'Retained cue' }] }));
	base.set(new TextEncoder().encode('RF64'));
	const length = 16 * 1024 ** 2 + 1;
	const header = new Uint8Array(8); header.set(new TextEncoder().encode('iXML')); new DataView(header.buffer).setUint32(4, length, true);
	const xml = new Uint8Array(length).fill(32); xml.set(new TextEncoder().encode('<BWFXML><NOTE>'));
	xml.set(new TextEncoder().encode('</NOTE></BWFXML>'), xml.length - 16);
	new DataView(base.buffer).setBigUint64(20, BigInt(base.length + 8 + length + 1 - 8), true);
	new DataView(base.buffer).setBigUint64(36, BigInt(expectedPcm[0]!.length), true);
	return { file: new File([base, header, xml, Uint8Array.of(0)], 'Recorder.wav', { type: 'audio/wav' }),
		expectedTags: { title: 'Retained title' }, expectedPcm, expectedSampleRate: 48_000,
		expectedBextDescription: 'Retained recorder metadata', expectedMarker: { name: 'Retained cue', positionFrame: 1200 } };
}

function frozenPcm16(fixture: string, name: string, expectedTags: PcmMetadataImportCase['expectedTags']): PcmMetadataImportCase {
	const bytes = Buffer.from(readFileSync(new URL(`../fixtures/${fixture}.base64`, import.meta.url), 'utf8').trim(), 'base64');
	const aiff = fixture.endsWith('.aiff');
	return { file: new File([bytes], name, { type: aiff ? 'audio/aiff' : 'audio/wav' }), expectedTags, expectedSampleRate: 48_000,
		expectedPcm: aiff ? [aiffPcm16Samples(bytes)] : readWavePcm(bytes).channels };
}

/** Independent oracle for the frozen mono, signed16-bit big-endian AIFF files. */
function aiffPcm16Samples(bytes: Buffer): Float32Array {
	assert.equal(bytes.toString('ascii', 0, 4), 'FORM');
	assert.equal(bytes.toString('ascii', 8, 12), 'AIFF');
	let frames: number | undefined;
	let samples: Float32Array | undefined;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32BE(offset + 4);
		if (id === 'COMM') {
			assert.equal(bytes.readUInt16BE(offset + 8), 1);
			frames = bytes.readUInt32BE(offset + 10);
			assert.equal(bytes.readUInt16BE(offset + 14), 16);
		}
		if (id === 'SSND') {
			const start = offset + 16 + bytes.readUInt32BE(offset + 8);
			samples = Float32Array.from({ length: (offset + 8 + size - start) / 2 }, (_, frame) => bytes.readInt16BE(start + frame * 2) / 32768);
		}
		offset += 8 + size + size % 2;
	}
	assert.ok(samples);
	assert.equal(samples.length, frames);
	return samples;
}

/** A legal PNG text chunk increases size while retaining the original one-pixel image. */
function largeArtworkPng(): Uint8Array<ArrayBuffer> {
	const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');
	const body = Buffer.alloc(2300 * 1024, 88); body.write('Comment\0');
	const extra = Buffer.alloc(body.length + 12); extra.writeUInt32BE(body.length); extra.write('tEXt', 4); body.copy(extra, 8);
	let crc = 0xffff_ffff;
	for (const byte of extra.subarray(4, -4)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
	}
	extra.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, extra.length - 4);
	return Uint8Array.from(Buffer.concat([image.subarray(0, -12), extra, image.subarray(-12)]));
}
