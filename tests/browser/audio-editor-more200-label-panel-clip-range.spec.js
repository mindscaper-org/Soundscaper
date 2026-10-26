/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { deliverySelectionArchive } from '../helpers/more200-delivery-selection-fixture.ts';
import { strFromU8, unzipSync } from 'fflate';

test('Manage labels New label uses the selected native clip span and preserves it in Save and history', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selected take.sscape', mimeType: 'application/zip', buffer: Buffer.from(await (await deliverySelectionArchive()).arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'delivery-clip-selection'); await waitForProjectActivation(editor);
	const clip = editor.locator('[data-clip-id="selected"]'); await clip.focus(); await clip.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await panel.getByRole('button', { name: 'New label', exact: true }).click();
	await expect(panel.locator('.timecode__display').nth(0)).toHaveText('00h00m01.000s');
	await expect(panel.locator('.timecode__display').nth(1)).toHaveText('00h00m01.500s');
	const downloaded = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloaded))['project.json']));
	const label = saved.tracks.find(track => track.type === 'label').labels[0]; expect(label.startFrame).toBe(48_000); expect(label.endFrame).toBe(72_000);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(panel.locator('[data-label-id]')).toHaveCount(0);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(panel.locator('.timecode__display').nth(1)).toHaveText('00h00m01.500s');
});
