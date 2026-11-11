/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installControlledFocusCallbacks, holdFocusCallbacks, flushFocusCallbacks } from './helpers/controlled-focus-callbacks.js';

test('macro indentation caret handoff preserves characters typed before its frame', async ({ page }) => {
	await installControlledFocusCallbacks(page, 'animation-frame');
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	const source = manager.locator('[data-macro-script-source]');
	await source.fill(''); await source.focus();
	await holdFocusCallbacks(page);
	try {
		await page.keyboard.press('Tab');
		await expect(source).toHaveValue('  ');
		await page.keyboard.type('f');
		await expect(source).toHaveValue('  f');
	} finally { await flushFocusCallbacks(page); }
	await page.keyboard.type('oo');
	await expect(source).toHaveValue('  foo');
});
