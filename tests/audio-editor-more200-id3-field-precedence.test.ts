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

for (const format of ['wav', 'mp3'] as const) {
	test(`the ${format} export keeps the visible artist authoritative over a custom uppercase alias`, async () => {
		const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format,
			metadataArtist: 'Reviewed performer', metadataCustom: JSON.stringify({ ARTIST: 'Secondary custom value' }) };
		const metadata = exportDialogMetadataFields(settings, JSON.parse(settings.metadataCustom) as Readonly<Record<string, unknown>>);
		const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(format, false, metadata) });
		// The actual dialog merge retains both entries; the file writer selects the standard frame.
		assert.equal(request.metadata.artist, 'Reviewed performer');
		assert.equal(request.metadata.ARTIST, 'Secondary custom value');
		const samples = new Float32Array(48_000);
		const body = format === 'wav'
			? new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, metadata: request.metadata }))])
			: await embedAudioFileMetadata(new Blob([await encodeDedicatedAudioPcm({ format: 'mp3',
				input: new Uint8Array(samples.buffer), frameCount: samples.length, sampleRate: 48_000, channelCount: 1,
				settings: { bitrateKbps: 192 }, maximumOutputBytes: 1024 ** 2 }, { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) })]), format, request.metadata);
		const input = new Input({ source: new BlobSource(body), formats: ALL_FORMATS });
		try {
			const tags = await input.getMetadataTags();
			assert.equal(tags.artist, 'Reviewed performer');
			assert.equal(tags.raw?.TPE1, 'Reviewed performer');
			assert.deepEqual(tags.raw?.TXXX, { ARTIST: 'Secondary custom value' });
			if (format === 'wav') assert.equal(tags.raw?.IART, 'Reviewed performer');
		} finally { input.dispose(); }
	});
}
