/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('imported SubRip styling supplies plain label text through Undo and Redo', async ({ page }) => {
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
	expect(errors).toEqual([]);
});
