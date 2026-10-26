/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { LOCALIZED_M4A_ARTIST, localizedM4aMetadataFixture } from '../helpers/localized-m4a-metadata-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const style of ['mdta', 'ilst']) for (const multiple of [false, true]) test(`File Import and native Save retain localized MP4 ${style} credits; multiple=${multiple}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await localizedM4aMetadataFixture(multiple, style), encoded = new Uint8Array(await file.arrayBuffer());
	const reference = await page.evaluate(async bytes => {
		const buffer = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(Uint8Array.from(bytes).buffer);
		return Array.from({ length: buffer.numberOfChannels }, (_, channel) => [...buffer.getChannelData(channel)]);
	}, [...encoded]);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(encoded) });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await pending)), project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources[0], contribution = source.provenance.contributions[0];
	expect(contribution.warnings).toEqual([]); expect(contribution.metadata.normalized.artist).toBe('Original performer');
	expect(contribution.metadata.normalized.title).toBe(style === 'mdta' ? 'Localized credit control' : 'Two retained covers');
	if (style === 'mdta') expect(contribution.metadata.raw.engineer).toBe('Unrelated engineer');
	else expect(contribution.metadata.normalized.comment).toBe('After covers');
	expect(contribution.metadata.raw[style === 'mdta' ? 'artist' : '©ART']).toEqual(multiple ? LOCALIZED_M4A_ARTIST : 'Original performer');
	expect(source).toMatchObject({ sampleRate: 44_100, frameCount: reference[0].length, channelCount: reference.length });
	const pcm = Buffer.from(Object.entries(entries).find(([key]) => key.endsWith('.f32c'))[1]);
	let maximumError = 0;
	for (let channel = 0; channel < reference.length; channel++) for (let frame = 0; frame < reference[channel].length; frame++) {
		maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + (channel * source.frameCount + frame) * 4) - reference[channel][frame]));
	}
	expect(maximumError).toBeLessThan(1e-6);
});
