/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('SubRip styling survives Undo/Redo and Western ANSI imports with visible accented labels', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Styled.srt', mimeType: 'application/x-subrip',
		buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n<B><i>Hello & welcome</i></B>\n') }]);
	const label = editor.locator('[data-label-id]');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Hello & welcome');
	await expect(label.locator('[data-label-banner]')).toHaveText('Hello & welcome');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Hello & welcome');
	// The encoding/style matrix also crosses real controller/store/Scape custody in Node.
	await chooseFileAction(page, editor, 'Import');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'western-captions.srt', mimeType: 'application/x-subrip',
		buffer: Buffer.from('1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n\r\n', 'latin1') });
	await expect(editor.locator('[data-label-id]')).toHaveCount(2);
	const western = editor.locator('[data-label-id]').filter({ hasText: 'Élodie au café' });
	await expect(western).toHaveCount(1);
	await expect(western.locator('[data-label-banner]')).toHaveText('Élodie au café');
	expect(errors).toEqual([]);
});
