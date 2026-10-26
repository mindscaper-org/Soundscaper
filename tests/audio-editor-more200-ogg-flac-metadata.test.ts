/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { ordinaryOggFlacFixture } from './helpers/ogg-multiplexed-tail-fixture.ts';
import { oggFlacMetadataReadView } from '../src/common/editor/ogg-flac-metadata-read-view.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';
import { ordinaryOggOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

const OGG_FLAC_CREDITS = { title: 'Field recording', artist: 'Ada — reviewed credit', album: 'Quiet places',
	date: '2026-10-23', licence: 'CC BY 4.0', id3Artwork: JSON.stringify([{ mimeType: 'image/png', pictureType: 3,
		description: 'Original cover', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=' }]) };

test('Ogg-FLAC import metadata retains the embedded programme credits and cover attachment', async () => {
	const file = await ordinaryOggFlacFixture(OGG_FLAC_CREDITS);
	const inspection = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, OGG_FLAC_CREDITS.title);
	assert.equal(inspection.metadata.normalized?.artist, OGG_FLAC_CREDITS.artist);
	assert.equal(inspection.metadata.raw?.LICENCE, OGG_FLAC_CREDITS.licence);
	assert.ok(inspection.attachments.some(value => value.kind === 'coverFront' && value.description === 'Original cover' && value.byteLength === 68));
});

test('continued Ogg-FLAC header packets retain artwork without reading the audio body', async () => {
	const picture = JSON.parse(OGG_FLAC_CREDITS.id3Artwork) as { data: string }[];
	const bytes = new Uint8Array(80_000); bytes.set(Buffer.from(picture[0]!.data, 'base64'));
	picture[0]!.data = Buffer.from(bytes).toString('base64');
	const file = await ordinaryOggFlacFixture({ ...OGG_FLAC_CREDITS, id3Artwork: JSON.stringify(picture) });
	let maximumEnd = 0;
	class BoundedFile extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		assert.ok(end - start <= 65_307); maximumEnd = Math.max(maximumEnd, end); return super.slice(start, end, type);
	} }
	const bounded = new BoundedFile([file], file.name, { type: file.type });
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const view = await oggFlacMetadataReadView(bounded, header); assert.ok(view);
	assert.ok(maximumEnd < file.size - 100, 'metadata view must not read the FLAC audio packet');
	const inspection = await inspectImportedMediaMetadata(view);
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, OGG_FLAC_CREDITS.title);
	assert.ok(inspection.attachments.some(value => value.kind === 'coverFront' && value.byteLength === 80_000));
});

test('Ogg-FLAC metadata accepts unknown header counts and fences aborts and invalid page integrity', async () => {
	const original = await ordinaryOggFlacFixture(OGG_FLAC_CREDITS);
	const bytes = new Uint8Array(await original.arrayBuffer()); bytes[35] = 0; bytes[36] = 0;
	new DataView(bytes.buffer).setUint32(22, oggPageCrc(bytes.subarray(0, 79)), true);
	assert.equal((await inspectImportedMediaMetadata(new Blob([bytes]))).metadata.normalized?.artist, OGG_FLAC_CREDITS.artist);
	const aborted = new AbortController(); aborted.abort(new DOMException('Canceled import', 'AbortError'));
	await assert.rejects(oggFlacMetadataReadView(original, bytes.subarray(0, 12), aborted.signal), { name: 'AbortError' });
	const pending = new AbortController();
	class RetiredFile extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		const part = super.slice(start, end, type), read = part.arrayBuffer.bind(part);
		part.arrayBuffer = async () => { const result = await read(); pending.abort(); return result; }; return part;
	} }
	await assert.rejects(oggFlacMetadataReadView(new RetiredFile([original], original.name), bytes.subarray(0, 12), pending.signal), { name: 'AbortError' });
	bytes[101] = bytes[101]! ^ 1;
	const invalid = await inspectImportedMediaMetadata(new Blob([bytes])); assert.equal(invalid.metadata.normalized, undefined);
	assert.ok(invalid.warnings.some(warning => /checksum/u.test(warning)));
	const opus = await ordinaryOggOpusFixture();
	assert.equal(await oggFlacMetadataReadView(opus, new Uint8Array(await opus.slice(0, 12).arrayBuffer())), null);
});
