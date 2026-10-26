/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('German folder menu actions author German default names', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/de/');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Auswahl in neuen Ordner verschieben');
	const first = editor.getByRole('treeitem', { name: 'Ordner Ordner 1, Ebene 1', exact: true });
	await expect(first).toBeVisible();
	await first.click({ button: 'right', position: { x: 40, y: 12 } });
	await page.getByRole('menuitem', { name: 'Neuer Ordner', exact: true }).click();
	const second = editor.getByRole('treeitem', { name: 'Ordner Ordner 2, Ebene 2', exact: true });
	await expect(second).toBeVisible();
	await second.press('F2');
	const name = editor.getByRole('textbox', { name: 'Ordner umbenennen', exact: true }); await name.fill('Mein Ordner'); await name.press('Enter');
	await expect(editor.getByRole('treeitem', { name: 'Ordner Mein Ordner, Ebene 2', exact: true })).toBeVisible();
});
