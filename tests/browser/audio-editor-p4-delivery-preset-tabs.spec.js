/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openExportDialog, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

async function saveAs(page, dialog, name) {
	await page.bringToFront();
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(name);
}

test('two open Export dialogs retain each tab’s saved delivery preset after reload', async ({ page, context }) => {
	test.setTimeout(90_000);
	const first = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(first, [{ name: 'Voice.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(.1)], { sampleRate: 48_000, float: true })) }]);
	await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const other = await context.newPage();
	try {
		const second = await bootEditor(other, '/embed/en/', { defaultWorkspace: true }); await waitForProjectActivation(second);
		await expect(second).toHaveAttribute('data-clip-count', '1');
		await page.bringToFront();
		const firstDialog = await openExportDialog(page, first);
		await other.bringToFront();
		const secondDialog = await openExportDialog(other, second);
		await saveAs(page, firstDialog, 'Radio mono');
		await saveAs(other, secondDialog, 'Archive stereo');
		await other.reload(); await waitForEditor(other); await waitForProjectActivation(second);
		const reopened = await openExportDialog(other, second);
		await reopened.getByRole('button', { name: 'Preset', exact: true }).click();
		await expect(other.getByRole('option', { name: /^Radio mono \(custom\)/u })).toBeVisible();
		await expect(other.getByRole('option', { name: /^Archive stereo \(custom\)/u })).toBeVisible();
	} finally { await other.close(); }
});

test('a stale Export dialog Save as does not restore a preset deleted in the other tab', async ({ page, context }) => {
	test.setTimeout(90_000);
	const first = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(first, [{ name: 'Voice.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(.1)], { sampleRate: 48_000, float: true })) }]);
	await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const firstDialog = await openExportDialog(page, first);
	await saveAs(page, firstDialog, 'Retired delivery');
	const other = await context.newPage();
	try {
		const second = await bootEditor(other, '/embed/en/', { defaultWorkspace: true }); await waitForProjectActivation(second);
		const secondDialog = await openExportDialog(other, second);
		await page.bringToFront();
		await firstDialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
		await expect(firstDialog.getByRole('button', { name: 'Delete preset', exact: true })).toBeDisabled();
		await saveAs(other, secondDialog, 'New delivery');
		await other.reload(); await waitForEditor(other); await waitForProjectActivation(second);
		const reopened = await openExportDialog(other, second);
		await reopened.getByRole('button', { name: 'Preset', exact: true }).click();
		await expect(other.getByRole('option', { name: /^New delivery \(custom\)/u })).toBeVisible();
		await expect(other.getByRole('option', { name: /^Retired delivery \(custom\)/u })).toHaveCount(0);
	} finally { await other.close(); }
});
