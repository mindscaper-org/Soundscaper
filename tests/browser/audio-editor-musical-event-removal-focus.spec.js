/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

for (const event of [
	{ kind: 'Tempo event', add: 'Add tempo event', remove: 'Remove tempo event' },
	{ kind: 'Time signature event', add: 'Add time signature event', remove: 'Remove time signature event' },
]) test(`removing a secondary ${event.kind} restores focus to an editable root field`, async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: event.add, exact: true }).click();
	const added = musical.getByRole('form', { name: `${event.kind} 2`, exact: true });
	const remove = added.getByRole('button', { name: event.remove, exact: true });
	await remove.focus();
	await remove.press('Enter');
	await expect(added).toHaveCount(0);
	const root = musical.getByRole('form', { name: `${event.kind} 1`, exact: true });
	await expect(root.locator('input:enabled,button:enabled').first()).toBeFocused();
});
