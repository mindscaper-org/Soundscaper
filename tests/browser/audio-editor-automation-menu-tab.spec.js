/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Tab leaves and dismisses an ordinary automation curve menu', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const curve = row.locator('[data-automation-insert-point]').first();
	await curve.focus();
	await curve.press('i');
	await curve.press('Shift+F10');
	const menu = editor.getByRole('menu', { name: 'Automation curve', exact: true });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(menu).toHaveCount(0);
});
