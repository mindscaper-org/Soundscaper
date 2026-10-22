/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Cancel during generator storage preflight releases processing before the estimate returns', async ({ page }) => {
	await page.addInitScript(() => {
		if (typeof navigator.storage?.estimate !== 'function') return;
		const estimate = navigator.storage.estimate.bind(navigator.storage);
		navigator.storage.estimate = async function () {
			if (globalThis.__nextHoldGeneratorEstimate) {
				globalThis.__nextGeneratorEstimateStarted = true;
				await new Promise(resolve => { globalThis.__nextReleaseGeneratorEstimate = resolve; });
			}
			return await estimate();
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	test.skip(!await page.evaluate(() => typeof navigator.storage?.estimate === 'function'), 'This engine does not expose browser storage estimates.');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.locator('[data-generator-type="tone"]');
	await page.evaluate(() => { globalThis.__nextHoldGeneratorEstimate = true; });
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__nextGeneratorEstimateStarted === true)).toBe(true);
	try {
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'processing-effect');
		await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(0);
		await page.evaluate(() => { globalThis.__nextHoldGeneratorEstimate = false; });
		await chooseCommandAction(page, editor, 'Generate', 'Tone');
		await page.locator('[data-generator-type="tone"]').getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(1);
	} finally {
		await page.evaluate(() => {
			globalThis.__nextHoldGeneratorEstimate = false;
			globalThis.__nextReleaseGeneratorEstimate?.();
		});
	}
	await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(1);
});
