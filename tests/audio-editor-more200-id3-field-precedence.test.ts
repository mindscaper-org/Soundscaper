/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { embedAudioFileMetadata } from '../src/common/editor/audio-container-metadata.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
import { normalizeMediaMetadata } from '../src/common/editor/media-metadata.ts';
import { readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';

const settingsByFormat: Readonly<Record<string, Readonly<Record<string, number>>>> = {
	mp3: { bitrateKbps: 192 }, flac: { compressionLevel: 5 }, 'ogg-vorbis': { quality: 5 },
	opus: { bitrateKbps: 128, vbrMode: 1 }, wavpack: { compressionLevel: 2 },
};

for (const format of ['wav', 'mp3', 'flac', 'ogg-vorbis', 'opus', 'wavpack'] as const) {
	test(`the ${format} export keeps the visible artist authoritative over a custom uppercase alias`, async () => {
		const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format,
			metadataArtist: 'Reviewed performer', metadataCustom: JSON.stringify({ artist: 'Earlier canonical draft', ARTIST: 'Secondary custom value' }) };
		const metadata = exportDialogMetadataFields(settings, JSON.parse(settings.metadataCustom) as Readonly<Record<string, unknown>>);
		const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(format, false, metadata) });
		const requestMetadata = normalizeMediaMetadata(request.metadata);
		// The actual dialog merge retains both entries; the file writer selects the standard frame.
		assert.equal(requestMetadata.artist, 'Reviewed performer');
		assert.equal(requestMetadata.ARTIST, 'Secondary custom value');
		const samples = new Float32Array(48_000);
		const body = format === 'wav'
			? new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, metadata: requestMetadata }))])
			: await embedAudioFileMetadata(new Blob([await encodeDedicatedAudioPcm({ format,
				input: new Uint8Array(samples.buffer), frameCount: samples.length, sampleRate: 48_000, channelCount: 1,
				settings: settingsByFormat[format]!, maximumOutputBytes: 1024 ** 2 }, { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) })]), format, requestMetadata);
		const input = format === 'wavpack' ? null : new Input({ source: new BlobSource(body), formats: ALL_FORMATS });
		try {
			const tags = input ? await input.getMetadataTags() : await readApeMetadataTags(body);
			assert.equal(tags.artist, 'Reviewed performer');
			assert.ok(tags.raw && typeof tags.raw === 'object' && !Array.isArray(tags.raw));
			const raw = tags.raw as Readonly<Record<string, unknown>>;
			if (format === 'wav' || format === 'mp3') {
				assert.equal(raw.TPE1, 'Reviewed performer');
				assert.deepEqual(raw.TXXX, { ARTIST: 'Secondary custom value' });
				if (format === 'wav') assert.equal(raw.IART, 'Reviewed performer');
			} else assert.equal(raw.ARTIST, 'Reviewed performer');
		} finally { input?.dispose(); }
	});
}
