/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';

test('Truncate Silence to zero removes wholly silent time and clip selections with independent Undo', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	const editor = await bootEditor(page, '/embed/en/');
	for (const selection of ['time', 'clip']) {
		await test.step(`${selection} selection`, async () => {
			if (selection === 'clip') {
				const previous = await editor.getAttribute('data-project-id');
				await chooseCommandAction(page, editor, 'File', 'New');
				await expect(editor).not.toHaveAttribute('data-project-id', previous);
				await waitForProjectActivation(editor);
				await expect(editor).toHaveAttribute('data-clip-count', '0');
			}
			await chooseCommandAction(page, editor, 'Generate', 'Silence');
			const generator = page.getByRole('dialog', { name: 'Silence', exact: true });
			const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
			await duration.locator('.timecode-digit').first().click();
			await page.keyboard.type('000001000');
			await page.keyboard.press('Enter');
			await generator.getByRole('button', { name: 'Generate', exact: true }).click();
			await expect(generator).toBeHidden();
			await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
			if (selection === 'time') await chooseCommandAction(page, editor, 'Select', 'Select all');
			else await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
			await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Truncate Silence']);
			const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			const truncate = effect.locator('[data-effect-param="truncateTo"]').getByRole('group');
			if (selection === 'clip') {
				const reset = effect.getByRole('button', { name: 'Reset preset', exact: true });
				if (await reset.isEnabled()) await reset.click();
			}
			await expect(truncate.locator('.timecode-digit')).toHaveText([...'000000500']);
			await truncate.locator('.timecode-digit').first().click();
			await page.keyboard.type('000000000');
			await page.keyboard.press('Enter');
			await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			await expect(effect).toBeHidden({ timeout: 20_000 });
			await expect(editor.locator('[data-clip-id]')).toHaveCount(0);
			await chooseCommandAction(page, editor, 'Edit', 'Undo');
			await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
		}, { timeout: caseTimeout });
	}
});
