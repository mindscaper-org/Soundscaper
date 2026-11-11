/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a frequency-only macro command preserves the header-selected audio target', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'await sound.select.frequencies({low:100, high:1000});',
		"await sound.effect('audacity-invert');",
		"sound.log.info('inverted the selected clip');",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u);
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('inverted the selected clip');
});
