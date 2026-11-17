/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, readFile, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, collectClientErrors, disableNativeSavePicker,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Clip properties exports its clip effect stack as an executable macro', async ({ page }) => {
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Invert');
	await panel.getByRole('button', { name: 'Effect stack options', exact: true }).click();
	const exported = page.getByRole('menuitem', { name: 'Export as macro', exact: true });
	await expect(exported).toHaveAttribute('aria-disabled', 'false');
	const [download] = await Promise.all([
		page.waitForEvent('download', { timeout: 8_000 }), exported.click(),
	]);
	const path = await download.path();
	expect(path).not.toBeNull();
	expect(await readFile(path, 'utf8')).toBe('Invert:\n');
	expect(errors).toEqual([]);
});
