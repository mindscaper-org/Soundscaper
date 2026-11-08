/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('an open application menu stays reachable when the editor switches to compact layout', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 844 });
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Help', exact: true }).click();
	const menu = editor.locator('.kw-audio-editor__application-menu[role="menu"]');
	await expect(menu).toBeInViewport();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(editor).toHaveAttribute('data-layout', 'compact');
	await expect(menu).toBeInViewport();
	const about = menu.getByRole('menuitem', { name: 'About Soundscaper', exact: true });
	await expect(about).toBeInViewport();
	await about.click();
	await expect(page.getByRole('dialog', { name: 'About Soundscaper', exact: true })).toBeVisible();
});
