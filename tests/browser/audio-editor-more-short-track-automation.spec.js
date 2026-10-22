/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('a short track keeps every automation curve menu action clickable', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	for (let index = 0; index < 12; index += 1) {
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Decrease all track heights']);
	}
	await expect.poll(async () => (await row.boundingBox()).height).toBeLessThan(100);
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const curve = row.locator('[data-automation-insert-point]').first();
	await curve.press('i');
	await expect(row.locator('[data-automation-point-id]')).toHaveCount(2);
	await curve.press('Shift+F10');
	const menu = editor.getByRole('menu', { name: 'Automation curve', exact: true });
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitemradio', { name: 'Hold', exact: true }).click();
	await curve.press('Shift+F10');
	await expect(menu.getByRole('menuitemradio', { name: 'Hold', exact: true })).toHaveAttribute('aria-checked', 'true');
	await menu.getByRole('menuitem', { name: 'Close', exact: true }).click();
	await expect(menu).toHaveCount(0);
	await curve.press('Shift+F10');
	await menu.getByRole('menuitem', { name: 'Delete automation lane', exact: true }).click({ timeout: 3_000 });
	await expect(row.locator('[data-automation-point-id]')).toHaveCount(0);
});
