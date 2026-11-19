/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('ordinary editing preserves the admitted multiline name of a step macro', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const original = 'Opening\nRoom tone';
	const choosing = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: `${original}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Invert:\n') });
	const selected = manager.locator('[data-macro-id][aria-current="true"]');
	await expect.poll(() => selected.textContent()).toBe(original);
	const id = await selected.getAttribute('data-macro-id');
	const name = manager.getByRole('textbox', { name: 'Macro name', exact: true });
	await name.focus();
	await name.press('Control+End');
	await name.pressSequentially('!');
	await name.press('Shift+Enter');
	await name.pressSequentially('Review');
	await name.press('Enter');
	await expect(name).toBeFocused();
	await name.press('Tab');
	await manager.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	await expect.poll(() => manager.locator(`[data-macro-id="${id}"]`).textContent()).toBe(`${original}!\nReview`);
});
