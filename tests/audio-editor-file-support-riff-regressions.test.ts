/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createRiffInfoChunk, parseRiffInfo } from '../src/common/editor/riff-info.ts';
import { createRiffMarkerChunks, parseRiffMarkers, type RiffMarker } from '../src/common/editor/riff-markers.ts';
import { scanEncodedAudioMarkers } from '../src/common/editor/encoded-audio-marker-scan.ts';

const encoder = new TextEncoder();
function chunk(id: string, body: Uint8Array, littleEndian = true): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + body.length + body.length % 2);
	bytes.set(encoder.encode(id));
	new DataView(bytes.buffer).setUint32(4, body.length, littleEndian);
	bytes.set(body, 8);
	return bytes;
}
function wave(kind: 'RIFF' | 'RIFX' | 'RF64', parts: Uint8Array<ArrayBuffer>[]): Blob {
	const header = new Uint8Array(12);
	header.set(encoder.encode(kind));
	header.set(encoder.encode('WAVE'), 8);
	const size = 4 + parts.reduce((sum, part) => sum + part.length, 0);
	new DataView(header.buffer).setUint32(4, kind === 'RF64' ? 0xffff_ffff : size, kind !== 'RIFX');
	if (kind === 'RF64') {
		const ds64 = new Uint8Array(28);
		new DataView(ds64.buffer).setBigUint64(0, BigInt(size + 36), true);
		parts = [chunk('ds64', ds64), ...parts];
	}
	return new Blob([header, ...parts]);
}

test('WAV CSET also selects the encoding of cue labels and notes', async () => {
	const marker = createRiffMarkerChunks([{ sampleOffset: 0, label: 'CafX' }]);
	marker[marker.indexOf(88)] = 0xe9;
	const cset = new Uint8Array(8);
	new DataView(cset.buffer).setUint16(0, 1252, true);
	const file = new Blob([Uint8Array.from(encodeWav([Float32Array.of(0)], { preDataChunks: [chunk('CSET', cset), marker.subarray(0, 36), marker.subarray(36)] }))]);
	const inspected = await inspectWavBlobPcm(file);
	assert.equal((inspected.markers as readonly RiffMarker[])[0]?.label, 'Café');
	assert.equal((await scanEncodedAudioMarkers(file))?.markers[0]?.label, 'Café');
});

test('WAV region descriptions in ltxt become labels when no labl chunk exists', () => {
	const marker = createRiffMarkerChunks([{ sampleOffset: 0 }]);
	const body = new Uint8Array(20 + 7);
	new DataView(body.buffer).setUint32(0, 1, true);
	new DataView(body.buffer).setUint32(4, 32, true);
	body.set(encoder.encode('Chorus\0'), 20);
	const parsed = parseRiffMarkers(marker.subarray(8), [chunk('ltxt', body)]);
	assert.equal(parsed[0]?.label, 'Chorus');
	assert.equal(parsed[0]?.sampleLength, 32);
});

test('WAV INFO exports the album for players that read RIFF tags', () => {
	const info = createRiffInfoChunk({ album: 'Field recordings' });
	assert.ok(info.length > 0);
	assert.equal(parseRiffInfo([info.subarray(12)]).album, 'Field recordings');
});

test('WAV INFO prefers a full recording date over the legacy year alias', () => {
	const info = createRiffInfoChunk({ year: '2021', date: '2021-09-12' });
	assert.equal(parseRiffInfo([info.subarray(12)]).year, '2021-09-12');
});

test('RIFX imports rescue big-endian cue geometry and text', async () => {
	const fmt = new Uint8Array(16);
	new DataView(fmt.buffer).setUint32(4, 44_100);
	const cue = new Uint8Array(28);
	const view = new DataView(cue.buffer);
	view.setUint32(0, 1);
	view.setUint32(4, 7);
	cue.set(encoder.encode('data'), 12);
	view.setUint32(24, 2205);
	const text = new Uint8Array(9);
	new DataView(text.buffer).setUint32(0, 7);
	text.set(encoder.encode('Intro'), 4);
	const adtl = new Uint8Array(4 + chunk('labl', text, false).length);
	adtl.set(encoder.encode('adtl'));
	adtl.set(chunk('labl', text, false), 4);
	const scanned = await scanEncodedAudioMarkers(wave('RIFX', [chunk('fmt ', fmt, false), chunk('cue ', cue, false), chunk('LIST', adtl, false)]));
	assert.equal(scanned?.sampleRate, 44_100);
	assert.equal(scanned?.markers[0]?.sampleOffset, 2205);
	assert.equal(scanned?.markers[0]?.label, 'Intro');
});

test('RF64 compressed imports rescue cue markers through the ds64 directory', async () => {
	const marker = createRiffMarkerChunks([{ sampleOffset: 240, label: 'Pickup' }]);
	const scanned = await scanEncodedAudioMarkers(wave('RF64', [Uint8Array.from(marker)]));
	assert.equal(scanned?.markers[0]?.label, 'Pickup');
});

for (const placement of ['before-data', 'after-data'] as const) {
	test(`an unsupported WAV CSET preserves cue and region geometry with text warnings (${placement})`, async () => {
		const cset = new Uint8Array(8);
		new DataView(cset.buffer).setUint16(0, 866, true);
		const file = new Blob([Uint8Array.from(encodeWav([new Float32Array(1024)], {
			[placement === 'before-data' ? 'preDataChunks' : 'trailingChunks']: [chunk('CSET', cset)],
			markers: [{ id: 7, sampleOffset: 480, sampleLength: 240, label: 'Section', note: 'Comment' }],
		}))]);
		const inspected = await inspectWavBlobPcm(file);
		assert.deepEqual(inspected.markers, [{ id: 7, sampleOffset: 480, sampleLength: 240, label: '', note: '' }]);
		assert.ok(inspected.metadataWarnings.some(warning => warning.code === 'riff-marker-text-invalid' && /866/u.test(warning.message)));
		assert.equal(inspected.metadataWarnings.some(warning => warning.code === 'riff-markers-invalid'), false);
		const rescued = await scanEncodedAudioMarkers(file);
		assert.deepEqual(rescued?.markers, inspected.markers);
		assert.ok(rescued?.metadataWarnings?.some(warning => warning.code === 'riff-marker-text-invalid' && warning.codePage === 866));
	});
}
