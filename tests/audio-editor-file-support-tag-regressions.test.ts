/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApeFileMetadata } from '../src/common/editor/ape-file-metadata.ts';
import { readApeMetadataTags, wavPackAudioBlob } from '../src/common/editor/ape-metadata-reader.ts';
import { browserAacMetadataFormat, browserAacMetadataTags } from '../src/common/editor/browser-aac-metadata.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { decodeRiffMetadataText } from '../src/common/editor/riff-metadata-text.ts';

const encoder = new TextEncoder();
function ape(entries: Readonly<Record<string, string>>): Blob {
	const items = Object.entries(entries).map(([key, value]) => {
		const bytes = encoder.encode(value);
		const item = new Uint8Array(8 + key.length + 1 + bytes.length);
		new DataView(item.buffer).setUint32(0, bytes.length, true);
		item.set(encoder.encode(key), 8);
		item.set(bytes, 9 + key.length);
		return item;
	});
	const footer = new Uint8Array(32);
	footer.set(encoder.encode('APETAGEX'));
	const view = new DataView(footer.buffer);
	view.setUint32(8, 2000, true);
	view.setUint32(12, 32 + items.reduce((sum, item) => sum + item.length, 0), true);
	view.setUint32(16, items.length, true);
	return new Blob([new Uint8Array(32), ...items, footer]);
}
const picture = JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Waterfall at dawn', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=' }]);
function frameText(bytes: Uint8Array, id: string): string {
	let offset = 10;
	while (offset + 10 <= bytes.length) {
		const name = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
		const length = bytes.subarray(offset + 4, offset + 8).reduce((sum, byte) => sum * 128 + byte, 0);
		if (name === id) return new TextDecoder().decode(bytes.subarray(offset + 11, offset + 10 + length));
		offset += 10 + length;
	}
	return '';
}

test('WavPack APE tags remain readable ahead of an ID3v1 compatibility trailer', async () => {
	const audio = Uint8Array.from({ length: 64 }, (_, index) => index);
	const suffix = new Uint8Array(128);
	suffix.set(encoder.encode('TAG'));
	const file = new Blob([audio, createApeFileMetadata({ title: 'Archive' }), suffix]);
	assert.equal((await readApeMetadataTags(file)).title, 'Archive');
	assert.deepEqual(new Uint8Array(await (await wavPackAudioBlob(file)).arrayBuffer()), audio);
});

test('APEv2 conventional Track, Disc, Year, and Album Artist names normalize on import', async () => {
	const tags = await readApeMetadataTags(ape({ Track: '3', Disc: '2', Year: '2008', 'Album Artist': 'Ensemble' }));
	assert.equal(tags.trackNumber, 3);
	assert.equal(tags.discNumber, 2);
	assert.equal(tags.date, '2008');
	assert.equal(tags.albumArtist, 'Ensemble');
});

test('APEv2 position/total pairs retain both values instead of becoming NaN', async () => {
	const tags = await readApeMetadataTags(ape({ TRACKNUMBER: '3/12', DISCNUMBER: '2/4' }));
	assert.equal(tags.trackNumber, 3);
	assert.equal(tags.tracksTotal, 12);
	assert.equal(tags.discNumber, 2);
	assert.equal(tags.discsTotal, 4);
});

test('WavPack cover artwork retains its exported description on reimport', async () => {
	const tags = await readApeMetadataTags(new Blob([new Uint8Array(64), createApeFileMetadata({ id3Artwork: picture })]));
	const image = (tags.images as Readonly<Record<string, unknown>>[])[0];
	assert.equal(image?.description, 'Waterfall at dawn');
});

test('AAC cover artwork is stored once and uses the standard artwork metadata mode', () => {
	const tags = browserAacMetadataTags({ id3Artwork: picture });
	assert.equal(tags.images?.length, 1);
	assert.equal(tags.raw, undefined);
	assert.equal(browserAacMetadataFormat({ id3Artwork: picture }), 'mdir');
});

test('AAC exports Custom Metadata JSON aliases as standard player-visible fields', () => {
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format: 'aac-m4a',
		metadataCustom: JSON.stringify({ track: '3/12', disc: '2/4', ALBUMARTIST: 'Ensemble' }) };
	// ExportDialog.start passes the visible Custom Metadata JSON through this request builder.
	const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(settings.format, false,
		JSON.parse(settings.metadataCustom) as Readonly<Record<string, string>>) });
	const tags = browserAacMetadataTags(request.metadata as Readonly<Record<string, string>>);
	assert.equal(tags.trackNumber, 3);
	assert.equal(tags.tracksTotal, 12);
	assert.equal(tags.discNumber, 2);
	assert.equal(tags.discsTotal, 4);
	assert.equal(tags.albumArtist, 'Ensemble');
});

test('ID3 exports separate total fields in standard track and disc position frames', () => {
	const tag = createAudioMetadataId3Tag({ trackNumber: '3', tracksTotal: '12', discNumber: '2', discsTotal: '4' });
	assert.equal(frameText(tag, 'TRCK'), '3/12');
	assert.equal(frameText(tag, 'TPOS'), '2/4');
});

test('RIFF CSET supports Windows Cyrillic text instead of discarding the metadata', () => {
	assert.equal(decodeRiffMetadataText(Uint8Array.of(0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0), 1251), 'Привет');
});
