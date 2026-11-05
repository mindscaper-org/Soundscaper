/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { flushFocusCallbacks, holdFocusCallbacks, installControlledFocusCallbacks } from './helpers/controlled-focus-callbacks.js';

test('closing Search before its opening frame prevents stale autofocus from reopening it', async ({ page }) => {
	await installControlledFocusCallbacks(page, 'animation-frame');
	const editor = await bootEditor(page, '/embed/en/');
	const file = editor.getByRole('menuitem', { name: 'File', exact: true });
	const bounds = await file.boundingBox();
	if (!bounds) throw new Error('File menu is not visible.');
	await file.focus();
	await holdFocusCallbacks(page);
	try {
		await page.keyboard.press('ControlOrMeta+k');
		await expect(editor.locator('[data-editor-search]')).toHaveAttribute('data-editor-search-open', 'true');
		await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		await expect(editor.locator('[data-editor-search]')).toHaveAttribute('data-editor-search-open', 'false');
	} finally {
		await flushFocusCallbacks(page);
	}
	await expect(editor.locator('[data-editor-search]')).toHaveAttribute('data-editor-search-open', 'false');
	await expect(file).toBeFocused();
});
