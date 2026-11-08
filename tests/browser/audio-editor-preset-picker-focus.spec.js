/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('canceling preset import keeps focus at its surviving preset options trigger', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await page.keyboard.press('Control+k');
	await editor.locator('[data-editor-search-input]').fill('Reverb');
	await editor.locator('[data-editor-search-popup] [data-editor-search-key="command:audacity-reverb"]').click();
	const dialog = page.locator('[data-selection-effects-dialog]');
	const more = dialog.getByRole('button', { name: 'More options', exact: true });
	await more.click();
	const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await choosing).setFiles([]);
	await expect(dialog).toBeVisible();
	expect(await page.evaluate(() => document.activeElement?.tagName), 'cancel must not leave focus on the page behind a modal').not.toBe('BODY');
	await expect(more).toBeFocused();
});
