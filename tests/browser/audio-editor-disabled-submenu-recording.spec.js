/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test('disabled Open recent owns no actionable child menu during recording', async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const first = await editor.getAttribute('data-project-id');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', first);
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File', exact: true }).click();
	const recent = page.getByRole('menu', { name: 'File', exact: true }).getByRole('menuitem', { name: /^Open recent\b/u });
	await expect(recent).toHaveAttribute('aria-disabled', 'true');
	await recent.hover();
	await expect(recent.locator(':scope > [role="menu"]')).toHaveCount(0);
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
});
