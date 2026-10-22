/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('a macro review acknowledgement belongs to the exact imported program text', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const chooserPending = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import program', exact: true }).click();
	const chooser = await chooserPending;
	await chooser.setFiles({ name: 'review.soundscapemacro', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
		schemaVersion: 1, kind: 'script', engine: 'soundscaper-macro-js/1', name: 'Review', source: "sound.log.info('original');",
	})) });
	const review = manager.locator('[data-macro-script-review]').getByRole('checkbox');
	const enable = manager.locator('.audio-editor-macro-script__actions').getByRole('button');
	await review.click();
	await expect(review).toBeChecked();
	await manager.getByRole('textbox', { name: 'Program name', exact: true }).fill('Renamed review');
	await manager.getByRole('textbox', { name: 'Program name', exact: true }).press('Enter');
	await expect(review).toBeChecked();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("sound.log.info('changed after review');");
	await expect(review).not.toBeChecked();
	await expect(enable).toBeDisabled();
	await review.click();
	await enable.click();
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toContainText('changed after review');
});
