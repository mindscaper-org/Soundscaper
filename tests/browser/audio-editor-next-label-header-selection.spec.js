/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('selecting a label track header prevents Delete from removing earlier selected audio', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await importFiles(editor, [{ name: 'Cues.txt', mimeType: 'text/plain', buffer: Buffer.from('0\t0.1\tCue\n') }]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.locator('[data-label-track] [data-track-name]').click();
	await expect(editor.locator('[data-label-track] [data-track-header]')).toHaveAttribute('data-selected', 'true');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
