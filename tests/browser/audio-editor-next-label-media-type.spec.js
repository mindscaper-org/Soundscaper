/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction } from './audio-editor-test-helpers.js';

for (const encoding of ['windows-1252', 'utf-16le']) test(`File Import reads extensionless SubRip ${encoding} using its declared media type`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const text = '1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n';
	const buffer = encoding === 'windows-1252' ? Buffer.from(text, 'latin1') : Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
	await chooseFileAction(page, editor, 'Import');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Captions', mimeType: 'application/x-subrip', buffer });
	const label = editor.locator('[data-label-id]');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Élodie au café');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Élodie au café');
});
