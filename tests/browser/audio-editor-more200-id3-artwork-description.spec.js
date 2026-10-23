/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';

test('Export artwork descriptions remain distinct after File Import and native Save', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.locator('[data-export-metadata-dialog]');
	await metadata.locator('summary').filter({ hasText: 'Additional metadata (JSON)' }).click();
	const descriptions = ['Reviewed cover', 'Reviewed cover '];
	await metadata.getByRole('textbox', { name: 'Additional metadata (JSON)', exact: true }).fill(JSON.stringify({
		id3Artwork: JSON.stringify(descriptions.map((description, index) => ({
			mimeType: 'image/png', pictureType: index ? 4 : 3, description, data: png,
		}))),
	}));
	await metadata.getByRole('button', { name: 'Done', exact: true }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	expect(Buffer.from(bytes).includes(Buffer.from('Reviewed cover \0'))).toBe(true);
	let peak = 0;
	await streamWavBlobPcm(new Blob([bytes]), { onChunk(channels) {
		for (const sample of channels[0]) peak = Math.max(peak, Math.abs(sample));
	} });
	expect(peak).toBeGreaterThan(.1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Reviewed art.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) });
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	const imported = document.sources.find(source => source.name === 'Reviewed art.wav');
	expect(imported).toMatchObject({ sampleRate: 48_000, channelCount: 2 });
	const origin = imported.provenance.contributions[0];
	expect(origin.warnings).toEqual([]);
	const images = origin.attachments.filter(image => image.mimeType === 'image/png');
	expect(images.map(image => image.description)).toEqual(descriptions);
	expect(images[0].sha256).toBe(images[1].sha256);
});
