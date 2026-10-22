/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, BufferSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { browserAacMetadataFormat, browserAacMetadataTags } from '../src/common/editor/browser-aac-metadata.ts';
import { normalizeMediaMetadata } from '../src/common/editor/media-metadata.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';

function dialogMetadata(pictureTypes: readonly number[], extra: Readonly<Record<string, string>> = {}) {
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format: 'aac-m4a' };
	const custom = { ...extra, id3Artwork: JSON.stringify(pictureTypes.map((pictureType, index) => ({
		mimeType: 'image/png', pictureType, description: `Album artwork ${index}`, data: PNG,
	}))) };
	const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(settings.format, false,
		exportDialogMetadataFields(settings, custom)) });
	return normalizeMediaMetadata(request.metadata);
}

async function exportedAac(metadata: Readonly<Record<string, string>>): Promise<Blob> {
	const original = new Input({ source: new BufferSource(aacLcM4a48_000Fixture()), formats: [MP4] });
	try {
		const track = await original.getPrimaryAudioTrack();
		assert.ok(track);
		const packet = await new EncodedPacketSink(track).getFirstPacket();
		const config = await track.getDecoderConfig();
		assert.ok(packet && config);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ metadataFormat: browserAacMetadataFormat(metadata) }), target });
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		output.setMetadataTags(browserAacMetadataTags(metadata));
		await output.start();
		await source.add(new EncodedPacket(packet.data, 'key', 0, packet.duration), { decoderConfig: config });
		await output.finalize();
		assert.ok(target.buffer);
		return new Blob([target.buffer], { type: 'audio/mp4' });
	} finally { original.dispose(); }
}

test('AAC export refuses to silently discard valid non-front artwork selected in Metadata', async () => {
	for (const types of [[4], [0], [3, 4]]) {
		const metadata = dialogMetadata(types);
		assert.ok(metadata.id3Artwork, 'the real dialog field merge and validator retain the supported picture');
		await assert.rejects(exportedAac(metadata), /AAC.*front.cover.*artwork/iu);
	}
});

test('front artwork still writes exact image bytes in ordinary and extended AAC metadata', async () => {
	const extensions: readonly Readonly<Record<string, string>>[] = [{}, { producer: 'Ensemble' }];
	for (const extra of extensions) {
		const blob = await exportedAac(dialogMetadata([3], extra));
		const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
		try {
			const tags = await input.getMetadataTags();
			assert.equal(tags.images?.length, 1);
			assert.deepEqual(tags.images?.[0]?.data, Uint8Array.from(Buffer.from(PNG, 'base64')));
			assert.ok(await input.getPrimaryAudioTrack(), 'the AAC stream remains available');
		} finally { input.dispose(); }
	}
});
