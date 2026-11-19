/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('the Project Bin shows the MPEG family for a Layer II file with a generic MPEG media type', async ({ page }) => {
	const buffer = Buffer.from(await readFile(new URL('../fixtures/twolame-0.4.0-sine.mp2.base64', import.meta.url), 'utf8'), 'base64');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Field MP2.mp2', mimeType: 'audio/mpeg', buffer }]);
	await editor.locator('[data-clip-id]').first().locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const format = editor.locator('[data-project-bin-item] .kw-audio-editor__project-bin-meta');
	await expect(format).toContainText('MPEG · 2 channels');
});
