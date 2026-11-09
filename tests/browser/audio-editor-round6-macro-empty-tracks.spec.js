/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('native No tracks preserves the normal recording when Delete runs', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
