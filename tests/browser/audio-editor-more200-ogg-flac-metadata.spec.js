/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { ordinaryOggFlacFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('File Import and native Save retain Ogg-FLAC programme credits and artwork', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await ordinaryOggFlacFixture({ title: 'Field recording', artist: 'Ada — reviewed credit', licence: 'CC BY 4.0',
		id3Artwork: JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Original cover',
			data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=' }]) });
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channels[0].maximum).toBeGreaterThan(.29);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 1024 });
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized).toMatchObject({ title: 'Field recording', artist: 'Ada — reviewed credit' });
	expect(contribution.metadata.raw.LICENCE).toBe('CC BY 4.0');
	expect(contribution.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'coverFront', description: 'Original cover', byteLength: 68 })]));
});
