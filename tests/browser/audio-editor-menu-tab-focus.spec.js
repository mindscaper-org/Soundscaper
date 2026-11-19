/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { flushFocusCallbacks, holdFocusCallbacks, installControlledFocusCallbacks } from './helpers/controlled-focus-callbacks.js';

test('leaving an application menu with Tab preserves a later pointer focus choice', async ({ page }) => {
	await installControlledFocusCallbacks(page, 'animation-frame');
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const stop = editor.getByRole('button', { name: 'Stop', exact: true });
	const bounds = await stop.boundingBox();
	if (!bounds) throw new Error('Stop is not visible.');
	await editor.getByRole('menuitem', { name: 'File', exact: true }).click();
	await editor.getByRole('menu', { name: 'File', exact: true }).getByRole('menuitem').first().focus();
	await holdFocusCallbacks(page);
	try {
		await page.keyboard.press('Tab');
		await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		await expect(stop).toBeFocused();
	} finally {
		await flushFocusCallbacks(page);
	}
	await expect(stop).toBeFocused();
});
