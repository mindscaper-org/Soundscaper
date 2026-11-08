/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('short Project Bin replacement owns initial focus, Tab and Escape cancellation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(toneA);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	const source = await card.getAttribute('data-source-id');
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await card.getByRole('button', { name: /More file actions/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await choosing).setFiles(createWavFixture({ name: 'Short.wav', duration: .1 }));
	const modal = page.locator('[data-project-bin-replacement-dialog]');
	await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
	for (let index = 0; index < 6; index += 1) {
		await page.keyboard.press('Tab');
		await expect.poll(() => modal.evaluate(node => node.contains(document.activeElement))).toBe(true);
	}
	await page.keyboard.press('Escape');
	await expect(modal).toBeHidden();
	await expect(card).toHaveAttribute('data-source-id', source);
});
