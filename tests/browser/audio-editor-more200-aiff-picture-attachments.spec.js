/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('AIFF Export and File Import retain both pictured attachments in Attribution and native Save', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const pictures = [
		{ mimeType: 'image/png', pictureType: 3, description: 'Front photograph', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=' },
		{ mimeType: 'image/png', pictureType: 4, description: 'Back photograph', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkTsBAAFEAPtKtXAbAAAAAElFTkSuQmCC' },
	];
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AIFF');
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.locator('[data-export-metadata-dialog]');
	await metadata.locator('summary').filter({ hasText: 'Additional metadata (JSON)' }).click();
	await metadata.getByRole('textbox', { name: 'Additional metadata (JSON)', exact: true }).fill(JSON.stringify({ id3Artwork: JSON.stringify(pictures) }));
	await metadata.getByRole('button', { name: 'Done', exact: true }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	for (const picture of pictures) expect(Buffer.from(bytes).includes(Buffer.from(picture.data, 'base64'))).toBe(true);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await importFiles(editor, [{ name: 'Reviewed pictures.aiff', mimeType: 'audio/aiff', buffer: Buffer.from(bytes) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const imported = project.sources.find(source => source.name === 'Reviewed pictures.aiff');
	expect(imported).toMatchObject({ sampleRate: 48_000, channelCount: 2 });
	const attachments = imported.provenance.contributions[0].attachments.filter(image => image.mimeType === 'image/png');
	expect(attachments.map(image => image.description)).toEqual(pictures.map(picture => picture.description));
	for (const [index, picture] of pictures.entries()) expect(attachments[index].sha256).toBe(createHash('sha256').update(Buffer.from(picture.data, 'base64')).digest('hex'));
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]'); await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).last().click();
	await expect(attribution.getByText('attachment: images[1]', { exact: true })).toBeVisible();
	await expect(attribution.getByText(/Back photograph · image\/png/u)).toBeVisible();
});
