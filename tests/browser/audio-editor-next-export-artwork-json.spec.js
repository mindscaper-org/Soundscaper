/* SPDX-License-Identifier: AGPL-3.0-only */

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';

test('Export Custom Metadata retains explicitly requested canonical artwork in the written WAV', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.locator('[data-export-metadata-dialog]');
	await metadata.locator('summary').filter({ hasText: 'Additional metadata (JSON)' }).click();
	await metadata.getByRole('textbox', { name: 'Additional metadata (JSON)', exact: true }).fill(JSON.stringify({
		id3Artwork: JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Explicit custom cover', data: png }]),
	}));
	await metadata.getByRole('button', { name: 'Done', exact: true }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: ALL_FORMATS });
	try {
		const tags = await input.getMetadataTags();
		expect(tags.images).toHaveLength(1);
		expect(Buffer.from(tags.images[0].data)).toEqual(Buffer.from(png, 'base64'));
	} finally { input.dispose(); }
});
