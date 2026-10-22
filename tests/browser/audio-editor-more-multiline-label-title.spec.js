/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const surface of ['timeline', 'manager']) test(`editing an imported multiline caption in the ${surface} preserves its lines`, async ({ page }) => {
	const original = 'First line\nSecond line';
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Two lines.srt', mimeType: 'application/x-subrip',
		buffer: Buffer.from(`1\n00:00:01,000 --> 00:00:02,000\n${original}\n`) }]);
	const marker = editor.locator('[data-label-id]').first();
	await expect(marker).toHaveAttribute('aria-label', `Edit labels: ${original}`);
	let title;
	if (surface === 'timeline') {
		await marker.locator('[data-label-banner]').dblclick();
		title = marker.getByRole('textbox');
		await expect(title).toBeFocused();
		await title.press('Tab');
		await expect(marker).toHaveAttribute('aria-label', `Edit labels: ${original}`);
		await marker.locator('[data-label-banner]').dblclick();
	} else {
		await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
		title = editor.locator('[data-workspace-panel="labels"]').getByRole('textbox', { name: /^Label title:/u });
		await title.focus();
	}
	await title.press('Control+End');
	await title.pressSequentially('!');
	await title.press('Shift+Enter');
	await title.pressSequentially('Third line');
	await title.press('Enter');
	const edited = `${original}!\nThird line`;
	await expect(marker).toHaveAttribute('aria-label', `Edit labels: ${edited}`);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(marker).toHaveAttribute('aria-label', `Edit labels: ${original}`);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(marker).toHaveAttribute('aria-label', `Edit labels: ${edited}`);
});
