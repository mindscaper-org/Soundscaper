/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('an imported program can be edited and run without a foreign-code acknowledgement', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const chooserPending = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import program', exact: true }).click();
	const chooser = await chooserPending;
	await chooser.setFiles({ name: 'review.soundscapemacro', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
		schemaVersion: 1, kind: 'script', engine: 'soundscaper-macro-js/1', name: 'Review', source: "sound.log.info('original');",
	})) });
	await expect(manager.getByRole('checkbox')).toHaveCount(0);
	await expect(manager.getByRole('button', { name: 'Enable this program', exact: true })).toHaveCount(0);
	await expect(manager.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'idle');
	await manager.getByRole('textbox', { name: 'Program name', exact: true }).fill('Renamed program');
	await manager.getByRole('textbox', { name: 'Program name', exact: true }).press('Enter');
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("sound.log.info('updated program');");
	await expect(manager.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled();
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toContainText('updated program');
});
