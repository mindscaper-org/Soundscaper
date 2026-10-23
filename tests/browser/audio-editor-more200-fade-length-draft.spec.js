/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { deliverySelectionArchive } from '../helpers/more200-delivery-selection-fixture.ts';
import { strFromU8, unzipSync } from 'fflate';

for (const length of ['0.125', '0.0005']) test(`Fades accepts ordinary sequential typing of ${length} seconds and saves exact samples`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selected take.sscape', mimeType: 'application/zip',
		buffer: Buffer.from(await (await deliverySelectionArchive()).arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'delivery-clip-selection'); await waitForProjectActivation(editor);
	const clip = editor.locator('[data-clip-id="selected"]'); await clip.focus(); await clip.press('Enter');
	const fade = clip.locator('[data-clip-fade-handle="in"]');
	await clip.locator('.clip-header').click({ button: 'right' });
	const parent = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Fade in/u });
	await parent.hover();
	await parent.getByRole('menuitem', { name: 'Edit fade-in', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Fades', exact: true });
	const field = dialog.getByRole('textbox', { name: 'Fade-in length', exact: true });
	await field.clear();
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	await field.pressSequentially(length);
	await expect(field).toHaveValue(length);
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(fade).toHaveAttribute('aria-valuenow', length);
	const download = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await download))['project.json']));
	expect(saved.clips.find(candidate => candidate.id === 'selected').fadeInFrames).toBe(Math.round(Number(length) * 48_000));
	await editor.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(fade).toHaveAttribute('aria-valuenow', length);
});
