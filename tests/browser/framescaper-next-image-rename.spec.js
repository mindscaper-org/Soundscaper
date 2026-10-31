/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';

test('an imported image can be renamed from its existing timeline header', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.focus();
	await expect(clip).toBeFocused();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await expect(clip.getByRole('button', { name: 'Trim left edge', exact: true })).toBeVisible();
	await clip.locator('.clip-header__name').dblclick();
	const field = clip.getByRole('textbox'); await expect(field).toBeVisible();
	await field.fill('Renamed poster'); await field.press('Enter');
	await expect(editor.getByRole('group', { name: 'Image clip: Renamed poster', exact: true })).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']); await expect(clip).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(editor.getByRole('group', { name: 'Image clip: Renamed poster', exact: true })).toBeVisible();
});
