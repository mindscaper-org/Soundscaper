/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { embedAudioFileMetadata } from '../src/common/editor/audio-container-metadata.ts';
import { encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
const artwork = JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Cover', data: png }]);
const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) };
const formats = [
	{ format: 'flac', settings: { compressionLevel: 5 } },
	{ format: 'ogg-vorbis', settings: { quality: 5 } },
	{ format: 'opus', settings: { bitrateKbps: 128, vbrMode: 1 } },
	{ format: 'wavpack', settings: { compressionLevel: 2 } },
] as const;

for (const { format, settings } of formats) test(`Custom Metadata JSON artwork aliases remain real pictures in ${format}`, async () => {
	const pcm = new Float32Array(4608);
	for (let index = 0; index < pcm.length; index++) pcm[index] = Math.sin(index / 10) * 0.2;
	const bytes = await encodeDedicatedAudioPcm({ format, settings, input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, maximumOutputBytes: 2 * 1024 ** 2 }, dependencies);
	for (const key of ['ID3ARTWORK', 'id3artwork', 'id3-artwork']) {
		const dialog = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format,
			metadataCustom: JSON.stringify({ [key]: artwork, title: 'A picture' }) };
		// ExportDialog.start supplies this exact Custom Metadata JSON to the export request.
		const request = createExportDialogRequest(dialog, { metadata: exportDialogMetadata(format, false,
			JSON.parse(dialog.metadataCustom) as Readonly<Record<string, string>>) });
		const output = await embedAudioFileMetadata(new Blob([bytes]), format, request.metadata);
		const input = format === 'wavpack' ? null : new Input({ source: new BlobSource(output), formats: ALL_FORMATS });
		try {
			const tags = input ? await input.getMetadataTags() : await readApeMetadataTags(output);
			const images = tags.images as readonly { readonly data: Uint8Array }[] | undefined;
			assert.equal(images?.length, 1, 'a player must see the standard picture, rather than an opaque JSON comment');
			assert.deepEqual(Buffer.from(images![0]!.data), Buffer.from(png, 'base64'));
			assert.equal(tags.raw?.[key.toUpperCase()], undefined);
		} finally { input?.dispose(); }
	}
});
