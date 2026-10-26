/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';

test('an imported image stays searchable by its original filename after a header rename', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles({ name: 'Museum-2026.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const imported = editor.getByRole('group', { name: 'Image clip: Museum-2026', exact: true });
	await expect(imported).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await imported.press('Enter');
	await expect(imported.getByRole('button', { name: 'Trim left edge', exact: true })).toBeEnabled();
	await imported.locator('.clip-header__name').dblclick();
	const field = imported.getByRole('textbox');
	await field.fill('Exhibit'); await field.press('Enter');
	const renamed = editor.getByRole('group', { name: 'Image clip: Exhibit', exact: true });
	await expect(renamed).toBeVisible();
	const search = editor.locator('[data-editor-search-input]');
	await search.fill('Museum-2026.png');
	const result = editor.locator('[data-editor-search-kind="timeline"]').filter({ hasText: 'Exhibit' });
	await expect(result).toBeVisible();
	await result.click();
	await expect(renamed.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await search.fill('Exhibit');
	await expect(result).toBeVisible();
});
